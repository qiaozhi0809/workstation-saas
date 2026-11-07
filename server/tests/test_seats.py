from uuid import UUID

from sqlalchemy import select

from app.domain.students.seats import SEAT_ORDER, serialize_seats
from app.domain.students.service import list_roster
from app.models import Enrollment, Student
from tests.factories import make_class, make_student
from tests.seed_ids import YEAR_ID


def _seat(db, class_id: UUID, student_id: UUID, row: int | None, col: int | None) -> None:
    e = db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == class_id, Enrollment.student_id == student_id
        )
    ).one()
    e.seat_row, e.seat_col = row, col
    db.flush()


def test_serialize_seats_null_last(db):
    """L24:座位表名单的字段与排序只定义一处——有座位的先按行、列,没座位的排最后再按 mk;
    名册接口 list_roster 与总览看板取同一份序列化结果。"""
    cls = make_class(db, "座位序班")
    s_b = make_student(db, cls, "乙同学", "yts", gender="F", student_no="S02", avatar_seed="a2")
    s_a = make_student(db, cls, "甲同学", "jts", student_no="S01", avatar_seed="a1")
    s_c = make_student(db, cls, "丙同学", "bts", student_no="S03", avatar_seed="a3")
    s_d = make_student(db, cls, "丁同学", "dts", student_no="S04", avatar_seed="a4")
    _seat(db, cls, s_b, 2, 1)
    _seat(db, cls, s_a, 1, 3)
    _seat(db, cls, s_c, None, None)
    _seat(db, cls, s_d, None, None)
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Enrollment.student_id == Student.id)
        .where(Enrollment.class_id == cls, Enrollment.status == "active")
        .order_by(*SEAT_ORDER)
    ).all()
    seats = serialize_seats(rows)
    # 有座位的在前(1,3)→(2,1),没座位的在后按 mk:bts < dts
    assert [s.student_id for s in seats] == [s_a, s_b, s_c, s_d]
    assert [(s.seat_row, s.seat_col) for s in seats] == [(1, 3), (2, 1), (None, None), (None, None)]
    first = seats[0]
    assert (first.name, first.mk, first.student_no) == ("甲同学", "jts", "S01")
    assert (first.avatar_seed, first.class_role, first.seat_locked) == ("a1", None, False)
    assert first.gender is None
    assert seats[1].gender == "F"
    assert {s.enrollment_id for s in seats} == {e.id for e, _ in rows}
    # 名册接口就是这同一份
    assert list_roster(db, cls, UUID(YEAR_ID)) == seats
