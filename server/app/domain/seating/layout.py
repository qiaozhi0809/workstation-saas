"""桌椅排列:预览、保存、自动增减排。读写数据库,算法在 arrange.py。"""

from collections.abc import Mapping, Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import bindparam, select, update
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import record
from app.domain.roster.seats import lock_class
from app.domain.seating.arrange import (
    Grid,
    Placement,
    Sitter,
    arrange,
    auto_grid,
    grid_of,
    podium_seats,
)
from app.domain.seating.schemas import (
    LayoutDraft,
    LayoutPreview,
    LayoutSave,
    LayoutSaved,
    PreviewSeat,
)
from app.errors import ApiError
from app.models import Enrollment, SchoolClass, SeatArrangement, Student


def sitters_of(db: Session, cls: SchoolClass) -> list[Sitter]:
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
        .order_by(Enrollment.id)
        .execution_options(populate_existing=True)
    ).all()
    return [
        Sitter(
            id=e.id,
            seat=(e.seat_row, e.seat_col)
            if e.seat_row is not None and e.seat_col is not None
            else None,
            locked=bool(e.seat_locked),
            student_no=s.student_no,
            name=s.name,
        )
        for e, s in rows
    ]


def desk_count(sitters: Sequence[Sitter], g: Grid) -> int:
    pods = set(podium_seats(g))
    return sum(1 for s in sitters if s.seat not in pods)


def resolve_grid(draft: LayoutDraft, sitters: Sequence[Sitter]) -> Grid:
    pl, pr = draft.podium_left, draft.podium_right
    if draft.seat_layout == "manual":
        assert draft.cols is not None
        return Grid(draft.rows, draft.cols, draft.desk_size, pl, pr)
    probe = Grid(1, 1, draft.desk_size, pl, pr)
    rows, cols = auto_grid(desk_count(sitters, probe), draft.desk_size, draft.cols)
    return Grid(rows, cols, draft.desk_size, pl, pr)


def _plan(
    db: Session, cls: SchoolClass, draft: LayoutDraft
) -> tuple[list[Sitter], Grid, dict[UUID, Placement]]:
    sitters = sitters_of(db, cls)
    g = resolve_grid(draft, sitters)
    placements = arrange(sitters, g, draft.how, cls.seat_order, fill_all=True)  # type: ignore[arg-type]
    return sitters, g, placements


def preview_layout(db: Session, cls: SchoolClass, draft: LayoutDraft) -> LayoutPreview:
    sitters, g, placements = _plan(db, cls, draft)
    seats = [
        PreviewSeat(enrollment_id=i, row=p.seat[0], col=p.seat[1])
        for i, p in placements.items()
        if p.seat is not None
    ]
    return LayoutPreview(
        rows=g.rows,
        cols=g.cols,
        seats=seats,
        capacity=g.rows * g.cols + g.pod_left + g.pod_right,
        students=len(sitters),
        unseated=len(sitters) - len(seats),
    )


def apply_placements(
    db: Session,
    cls: SchoolClass,
    g: Grid,
    placements: Mapping[UUID, Placement],
    user_id: UUID | None,
) -> int:
    cls.seat_rows, cls.seat_cols, cls.desk_size = g.rows, g.cols, g.desk
    cls.podium_left, cls.podium_right = g.pod_left, g.pod_right
    version = cls.seat_version + 1
    cls.seat_version = version
    db.flush()
    db.execute(
        update(Enrollment)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
        .values(seat_row=None, seat_col=None, seat_locked=False),
        execution_options={"synchronize_session": False},
    )
    placed = [(i, p) for i, p in placements.items() if p.seat is not None]
    if placed:
        db.connection().execute(
            update(Enrollment)
            .where(Enrollment.id == bindparam("b_id"), Enrollment.class_id == cls.id)
            .values(
                seat_row=bindparam("b_row"),
                seat_col=bindparam("b_col"),
                seat_locked=bindparam("b_locked"),
            ),
            [
                {"b_id": i, "b_row": p.seat[0], "b_col": p.seat[1], "b_locked": p.locked}
                for i, p in placed
                if p.seat is not None
            ],
        )
    db.add(
        SeatArrangement(
            class_id=cls.id,
            version=version,
            seat_rows=g.rows,
            seat_cols=g.cols,
            desk_size=g.desk,
            podium_left=g.pod_left,
            podium_right=g.pod_right,
            layout=[
                {"enrollment_id": str(i), "row": p.seat[0], "col": p.seat[1], "locked": p.locked}
                for i, p in placed
                if p.seat is not None
            ],
            saved_by_user_id=user_id,
            saved_at=clock.utc_now(),
        )
    )
    db.flush()
    return version


def reflow_auto(db: Session, cls: SchoolClass, user_id: UUID | None) -> bool:
    """名单变动后按人数自动增减排;调用方已 lock_class,不 commit。"""
    if cls.seat_layout != "auto":
        return False
    sitters = sitters_of(db, cls)
    cur = grid_of(cls)
    rows, cols = auto_grid(desk_count(sitters, cur), cls.desk_size, cls.seat_cols)
    if (rows, cols) == (cls.seat_rows, cls.seat_cols):
        return False
    g = Grid(rows, cols, cur.desk, cur.pod_left, cur.pod_right)
    placements = arrange(sitters, g, "keep", cls.seat_order, fill_all=False)  # type: ignore[arg-type]
    apply_placements(db, cls, g, placements, user_id)
    return True


def save_layout(
    db: Session, cls: SchoolClass, body: LayoutSave, user_id: UUID, request: Request | None
) -> LayoutSaved:
    lock_class(db, cls)
    if body.base_version != cls.seat_version:
        current = cls.seat_version
        db.rollback()
        raise ApiError(
            409, "SEAT_VERSION_CONFLICT", "座位表已被其他人修改", {"current_version": current}
        )
    sitters, g, placements = _plan(db, cls, body)
    moved = (
        g != grid_of(cls)
        or body.how != "keep"
        or any(
            placements[s.id].seat != s.seat
            or (s.seat is not None and placements[s.id].locked != s.locked)
            for s in sitters
        )
    )
    cls.seat_layout = body.seat_layout
    cls.room = body.room
    if moved:
        if body.how in ("row", "col"):
            cls.seat_order = body.how
        apply_placements(db, cls, g, placements, user_id)
    record(
        db,
        user_id=user_id,
        action="class.layout",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={
            "desk_size": g.desk,
            "seat_layout": body.seat_layout,
            "rows": g.rows,
            "cols": g.cols,
            "podium_left": g.pod_left,
            "podium_right": g.pod_right,
            "how": body.how,
            "moved": moved,
        },
    )
    version = cls.seat_version
    db.commit()
    db.expire_all()
    return LayoutSaved(version=version, moved=moved, rows=g.rows, cols=g.cols)
