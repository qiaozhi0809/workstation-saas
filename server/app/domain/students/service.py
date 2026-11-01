from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.students.schemas import StudentProfile, StudentSeat
from app.errors import ApiError
from app.models import Enrollment, SchoolClass, Student
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import Perm


def class_scope(db: Session, class_id: UUID) -> Scope | None:
    cls = db.get(SchoolClass, class_id)
    if cls is None:
        return None
    return Scope(school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id)


def list_roster(db: Session, class_id: UUID, year_id: UUID) -> list[StudentSeat]:
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Enrollment.student_id == Student.id)
        .where(
            Enrollment.class_id == class_id,
            Enrollment.academic_year_id == year_id,
            Enrollment.status == "active",
        )
        .order_by(
            Enrollment.seat_row.asc().nulls_last(),
            Enrollment.seat_col.asc().nulls_last(),
            Student.mk,
        )
    ).all()
    return [
        StudentSeat(
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
        for e, s in rows
    ]


def find_enrolled_student(
    db: Session, student_id: UUID, year_id: UUID
) -> tuple[Student, Scope, Enrollment] | None:
    row = db.execute(
        select(Student, SchoolClass, Enrollment)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .join(SchoolClass, Enrollment.class_id == SchoolClass.id)
        .where(
            Student.id == student_id,
            Enrollment.academic_year_id == year_id,
            Enrollment.status == "active",
        )
    ).first()
    if row is None:
        return None
    student, cls, enrollment = row
    scope = Scope(
        school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id, student_id=student.id
    )
    return student, scope, enrollment


def _clean(value: Any) -> Any:
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, list) and not value:
        return None
    return value


def build_profile(
    student: Student,
    scope: Scope,
    enrollment: Enrollment,
    bindings: Sequence[Binding],
    caller_id: UUID,
) -> StudentProfile:
    data: dict[str, Any] = {
        "id": student.id,
        "enrollment_id": enrollment.id,
        "class_role": _clean(enrollment.class_role),
        "mk": student.mk,
        "name": student.name,
        "class_id": scope.class_id,
    }
    groups: dict[Perm, tuple[str, ...]] = {
        Perm.STUDENT_BASIC: ("gender", "student_no", "birthdate", "avatar_seed"),
        Perm.STUDENT_FAMILY: ("family_structure",),
        Perm.STUDENT_LEARNING: ("learning_summary",),
        Perm.STUDENT_PROFILE: ("personality", "health_notes", "tags"),
    }
    for perm, fields in groups.items():
        if can(bindings, perm, scope):
            for f in fields:
                data[f] = _clean(getattr(student, f))
    if can(bindings, Perm.TEACHER_NOTES, scope) and isinstance(student.teacher_notes, dict):
        data["teacher_notes"] = _clean(student.teacher_notes.get(str(caller_id)))
    return StudentProfile(**data)


def require_enrollment(db: Session, class_id: UUID, enrollment_id: UUID) -> Enrollment:
    enrollment = db.get(Enrollment, enrollment_id)
    if enrollment is None or enrollment.class_id != class_id or enrollment.status != "active":
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    return enrollment


def active_enrollments(db: Session, class_id: UUID) -> list[Enrollment]:
    return list(
        db.scalars(
            select(Enrollment)
            .where(Enrollment.class_id == class_id, Enrollment.status == "active")
            .order_by(Enrollment.id)
        ).all()
    )
