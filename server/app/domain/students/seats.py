"""座位表名单的字段与排序,名册接口与总览看板共用一份(L24):改字段只改这里。"""

from collections.abc import Iterable

from app.domain.students.schemas import StudentSeat
from app.models import Enrollment, Student

# 有座位的先按行、列;没座位的排最后,再按 mk
SEAT_ORDER = (
    Enrollment.seat_row.asc().nulls_last(),
    Enrollment.seat_col.asc().nulls_last(),
    Student.mk,
)


def seat_of(e: Enrollment, s: Student) -> StudentSeat:
    return StudentSeat(
        enrollment_id=e.id,
        student_id=s.id,
        name=s.name,
        mk=s.mk,
        seat_row=e.seat_row,
        seat_col=e.seat_col,
        avatar_seed=s.avatar_seed,
        gender=s.gender,
        student_no=s.student_no,
        birthdate=s.birthdate,
        class_role=e.class_role,
        seat_locked=e.seat_locked,
    )


def serialize_seats(rows: Iterable[tuple[Enrollment, Student]]) -> list[StudentSeat]:
    """``rows`` 是按 SEAT_ORDER 排好的 (Enrollment, Student) 对。"""
    return [seat_of(e, s) for e, s in rows]
