"""桌椅排列纯函数:不碰数据库,只做行列、顺序与座位分配的计算。"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from math import ceil
from typing import Literal, NamedTuple
from uuid import UUID

from app.models import SchoolClass

Seat = tuple[int, int]
Order = Literal["row", "col"]
How = Literal["keep", "row", "col"]
ROWS = (1, 12)
AUTO_ROWS = (4, 10)
POD_MAX = 2


@dataclass(frozen=True)
class Grid:
    rows: int
    cols: int
    desk: int
    pod_left: int = 0
    pod_right: int = 0


@dataclass(frozen=True)
class Sitter:
    id: UUID
    seat: Seat | None
    locked: bool
    student_no: str | None
    name: str


class Placement(NamedTuple):
    seat: Seat | None
    locked: bool


def grid_of(cls: SchoolClass) -> Grid:
    return Grid(
        rows=cls.seat_rows,
        cols=cls.seat_cols,
        desk=cls.desk_size,
        pod_left=cls.podium_left,
        pod_right=cls.podium_right,
    )


def col_range(desk: int) -> tuple[int, int]:
    return (3, 12) if desk == 3 else (2, 12)


def cols_ok(cols: int | None, desk: int) -> bool:
    if cols is None:
        return False
    lo, hi = col_range(desk)
    return lo <= cols <= hi and cols % desk == 0


def default_cols(desk: int) -> int:
    return 9 if desk == 3 else 8


def podium_seats(g: Grid) -> list[Seat]:
    left = [(0, -(i + 1)) for i in range(min(g.pod_left, POD_MAX))]
    right = [(0, i + 1) for i in range(min(g.pod_right, POD_MAX))]
    return left + right


def is_podium(seat: Seat | None) -> bool:
    return seat is not None and seat[0] == 0


def in_grid(g: Grid, seat: Seat) -> bool:
    if is_podium(seat):
        return seat in podium_seats(g)
    return 1 <= seat[0] <= g.rows and 1 <= seat[1] <= g.cols


def seat_keys(g: Grid, order: Order) -> list[Seat]:
    if order == "row":
        return [(r, c) for r in range(1, g.rows + 1) for c in range(1, g.cols + 1)]
    span = 1 if g.desk == 1 else g.desk
    keys: list[Seat] = []
    for start in range(1, g.cols + 1, span):
        for r in range(1, g.rows + 1):
            for c in range(start, min(start + span, g.cols + 1)):
                keys.append((r, c))
    return keys


def auto_grid(n: int, desk: int, pref_cols: int | None) -> tuple[int, int]:
    lo, hi = col_range(desk)

    def rows_for(c: int) -> int:
        return max(AUTO_ROWS[0], ceil(n / c))

    if n == 0:
        return 6, (pref_cols if cols_ok(pref_cols, desk) else default_cols(desk))
    if pref_cols is not None and cols_ok(pref_cols, desk) and ceil(n / pref_cols) <= AUTO_ROWS[1]:
        return rows_for(pref_cols), pref_cols
    best = None
    for c in range(lo, hi + 1):
        if c % desk:
            continue
        r = rows_for(c)
        if r > AUTO_ROWS[1]:
            continue
        # 空座少(人少时最少 4 排,这部分空位不算浪费)、排数接近 6、每排接近 8 个座位
        score = (r * c - max(n, AUTO_ROWS[0] * c)) * 0.5 + abs(r - 6) * 2 + abs(c - 8) * 1.5
        if best is None or score < best[0]:
            best = (score, r, c)
    return (best[1], best[2]) if best else (AUTO_ROWS[1], hi)


def _natural(no: str) -> tuple:
    # re.split with a capture group puts the digit runs at odd indexes
    return tuple(
        (0, int(part), "") if i % 2 else (1, 0, part)
        for i, part in enumerate(re.split(r"(\d+)", no))
        if part != ""
    )


def student_no_key(student_no: str | None, name: str) -> tuple:
    if not student_no:
        return (1, (), name)
    return (0, _natural(student_no), name)


def arrange(
    sitters: Sequence[Sitter], g: Grid, how: How, order: Order, fill_all: bool
) -> dict[UUID, Placement]:
    keys = seat_keys(g, order if how == "keep" else how)
    key_set = set(keys)
    pods = set(podium_seats(g))
    taken: set[Seat] = set()
    result: dict[UUID, Placement] = {}
    rest: list[Sitter] = []

    for s in sitters:
        if s.seat is not None and s.seat in pods and s.seat not in taken:
            result[s.id] = Placement(s.seat, s.locked)
            taken.add(s.seat)
    for s in sitters:
        if s.id in result:
            continue
        if s.locked and s.seat is not None and s.seat in key_set and s.seat not in taken:
            result[s.id] = Placement(s.seat, True)
            taken.add(s.seat)
    rest = [s for s in sitters if s.id not in result]

    if how in ("row", "col"):
        free = [k for k in keys if k not in taken]
        ordered = sorted(rest, key=lambda s: student_no_key(s.student_no, s.name))
        for i, s in enumerate(ordered):
            result[s.id] = Placement(free[i] if i < len(free) else None, False)
        return result

    over: list[Sitter] = []
    none: list[Sitter] = []
    for s in rest:
        if s.seat is not None and s.seat in key_set and s.seat not in taken:
            result[s.id] = Placement(s.seat, s.locked)
            taken.add(s.seat)
        elif s.seat is not None:
            over.append(s)
        else:
            none.append(s)
    over.sort(key=lambda s: s.seat)
    if fill_all:
        over += sorted(none, key=lambda s: student_no_key(s.student_no, s.name))
    else:
        for s in none:
            result[s.id] = Placement(None, False)
    free = [k for k in keys if k not in taken]
    for i, s in enumerate(over):
        result[s.id] = Placement(free[i] if i < len(free) else None, False)
    return result


def first_empty(
    g: Grid, occupied: set[Seat], order: Order, exclude: Seat | None = None
) -> Seat | None:
    for k in seat_keys(g, order):
        if k not in occupied and k != exclude:
            return k
    return None
