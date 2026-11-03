from uuid import uuid4

from app.domain.seating.arrange import (
    Grid,
    Placement,
    Sitter,
    arrange,
    auto_grid,
    col_range,
    cols_ok,
    default_cols,
    first_empty,
    in_grid,
    is_podium,
    podium_seats,
    seat_keys,
)


def sitter(name, no=None, seat=None, locked=False):
    return Sitter(id=uuid4(), seat=seat, locked=locked, student_no=no, name=name)


def test_col_ranges_and_defaults():
    assert [col_range(d) for d in (1, 2, 3)] == [(2, 12), (2, 12), (3, 12)]
    assert [default_cols(d) for d in (1, 2, 3)] == [8, 8, 9]
    assert cols_ok(6, 3) and not cols_ok(4, 3) and not cols_ok(1, 1) and not cols_ok(None, 2)


def test_podium_seats_order():
    assert podium_seats(Grid(6, 8, 2, pod_left=2, pod_right=1)) == [(0, -1), (0, -2), (0, 1)]


def test_in_grid_and_is_podium():
    g = Grid(2, 2, 2, pod_left=1)
    assert in_grid(g, (2, 2)) and in_grid(g, (0, -1))
    assert not in_grid(g, (3, 1)) and not in_grid(g, (0, -2)) and not in_grid(g, (0, 1))
    assert is_podium((0, 1)) and not is_podium((1, 1)) and not is_podium(None)


def test_seat_keys_col_order_by_desk():
    g = Grid(2, 6, 3)
    assert seat_keys(g, "col")[:6] == [(1, 1), (1, 2), (1, 3), (2, 1), (2, 2), (2, 3)]
    assert seat_keys(Grid(2, 2, 1), "col") == [(1, 1), (2, 1), (1, 2), (2, 2)]


def test_auto_grid_keeps_preferred_cols():
    assert auto_grid(45, 2, 8) == (6, 8)
    assert auto_grid(50, 2, 8) == (7, 8)
    assert auto_grid(10, 2, 8) == (4, 8)


def test_auto_grid_scores_when_no_preference():
    assert auto_grid(45, 3, None) == (5, 9)


def test_auto_grid_edges():
    assert auto_grid(0, 2, None) == (6, 8)
    assert auto_grid(0, 3, 6) == (6, 6)
    assert auto_grid(3, 1, None)[0] == 4
    assert auto_grid(130, 2, 8) == (10, 12)


def test_row_order_by_student_no_numeric():
    a, b, c = sitter("甲", "2026010"), sitter("乙", "2026009"), sitter("丙", "2026001")
    res = arrange([a, b, c], Grid(2, 3, 1), "row", "row", False)
    assert res[c.id].seat == (1, 1)
    assert res[b.id].seat == (1, 2)
    assert res[a.id].seat == (1, 3)


def test_missing_student_no_last():
    a, b, c, d = sitter("无号"), sitter("乙", "5"), sitter("丙", "5"), sitter("丁", "1")
    res = arrange([a, b, c, d], Grid(2, 2, 1), "row", "row", False)
    assert res[d.id].seat == (1, 1)
    first, second = sorted([b, c], key=lambda s: s.name)
    assert res[first.id].seat == (1, 2)
    assert res[second.id].seat == (2, 1)
    assert res[a.id].seat == (2, 2)


def test_keep_moves_overflow_in_seat_order_and_unlocks():
    s11 = sitter("a", seat=(1, 1))
    s12 = sitter("b", seat=(1, 2))
    s21 = sitter("c", seat=(2, 1))
    s22 = sitter("d", seat=(2, 2), locked=True)
    g = Grid(1, 2, 1)
    res = arrange([s11, s12, s21, s22], g, "keep", "row", False)
    assert res[s11.id] == Placement((1, 1), False)
    assert res[s12.id] == Placement((1, 2), False)
    assert res[s21.id] == Placement(None, False)
    assert res[s22.id] == Placement(None, False)
    extra = sitter("e")
    res = arrange([s11, s12, s21, s22, extra], g, "keep", "row", True)
    assert res[s21.id].seat is None and res[s22.id].seat is None and res[extra.id].seat is None


def test_keep_fill_all_seats_unseated_by_no():
    two, one = sitter("二", "2"), sitter("一", "1")
    res = arrange([two, one], Grid(2, 2, 1), "keep", "row", True)
    assert res[one.id] == Placement((1, 1), False)
    assert res[two.id] == Placement((1, 2), False)
    res = arrange([two, one], Grid(2, 2, 1), "keep", "row", False)
    assert res[one.id] == Placement(None, False) and res[two.id] == Placement(None, False)


def test_podium_students_never_move():
    g = Grid(2, 2, 1, pod_left=1)
    for how in ("keep", "row", "col"):
        for fill_all in (False, True):
            p = sitter("讲", "9", seat=(0, -1), locked=True)
            o = sitter("普", "1")
            res = arrange([p, o], g, how, "row", fill_all)
            assert res[p.id] == Placement((0, -1), True)
    p = sitter("讲", "9", seat=(0, -1))
    res = arrange([p], Grid(2, 2, 1), "keep", "row", False)
    assert res[p.id] == Placement((1, 1), False)


def test_locked_kept_in_row_reorder():
    nine = sitter("九", "9", seat=(1, 1), locked=True)
    one = sitter("一", "1")
    res = arrange([nine, one], Grid(2, 2, 1), "row", "row", False)
    assert res[nine.id] == Placement((1, 1), True)
    assert res[one.id] == Placement((1, 2), False)


def test_first_empty_respects_order_and_skips_podium():
    g = Grid(2, 2, 1, pod_left=1)
    assert first_empty(g, {(1, 1)}, "row") == (1, 2)
    assert first_empty(g, {(1, 1)}, "col") == (2, 1)
    assert first_empty(g, {(1, 1), (1, 2), (2, 1), (2, 2)}, "row") is None
    # 双人桌竖排:一组两列,先坐满组内再往后
    assert first_empty(Grid(2, 2, 2), {(1, 1)}, "col") == (1, 2)
    assert first_empty(g, set(), "row", exclude=(1, 1)) == (1, 2)
