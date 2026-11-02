import secrets
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import record
from app.domain.classes.service import class_scope_of
from app.domain.roster.schemas import StudentInput, StudentRecord
from app.domain.roster.seats import place_student, plan_placement
from app.domain.schools.service import require_active_year
from app.errors import ApiError
from app.models import Enrollment, SchoolClass, Student
from app.rbac.bindings import Binding, can
from app.rbac.roles import Perm

_GROUPS: dict[Perm, tuple[str, ...]] = {
    Perm.STUDENT_BASIC: ("boarding",),
    Perm.STUDENT_FAMILY: ("family_structure", "family_note", "contacts"),
    Perm.STUDENT_LEARNING: ("learning_summary",),
    Perm.STUDENT_PROFILE: ("personality", "health_notes", "tags", "note"),
}


def _record(e: Enrollment, s: Student, allowed: Sequence[str]) -> StudentRecord:
    data: dict[str, Any] = {
        "enrollment_id": e.id,
        "student_id": s.id,
        "name": s.name,
        "mk": s.mk,
        "seat_row": e.seat_row,
        "seat_col": e.seat_col,
        "avatar_seed": s.avatar_seed,
        "gender": s.gender,
        "student_no": s.student_no,
        "birthdate": s.birthdate,
        "class_role": e.class_role,
        "seat_locked": e.seat_locked,
    }
    for f in allowed:
        value = getattr(s, f)
        if f == "contacts":
            value = value or []
        elif f == "tags":
            value = list(value or [])
        elif f == "boarding":
            value = bool(value)
        data[f] = value
    return StudentRecord(**data)


def _allowed_fields(cls: SchoolClass, bindings: Sequence[Binding]) -> list[str]:
    scope = class_scope_of(cls)
    return [f for perm, fields in _GROUPS.items() if can(bindings, perm, scope) for f in fields]


def student_records(
    db: Session, cls: SchoolClass, year_id: UUID, bindings: Sequence[Binding]
) -> list[StudentRecord]:
    allowed = _allowed_fields(cls, bindings)
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Enrollment.student_id == Student.id)
        .where(
            Enrollment.class_id == cls.id,
            Enrollment.academic_year_id == year_id,
            Enrollment.status == "active",
        )
        .order_by(Student.student_no.asc().nulls_last(), Student.name, Enrollment.id)
    ).all()
    return [_record(e, s, allowed) for e, s in rows]


def check_student_no(
    db: Session, cls: SchoolClass, student_no: str | None, exclude_enrollment_id: UUID | None
) -> None:
    if student_no is None:
        return
    stmt = (
        select(Enrollment.id)
        .join(Student, Enrollment.student_id == Student.id)
        .where(
            Enrollment.class_id == cls.id,
            Enrollment.status == "active",
            Student.student_no == student_no,
        )
    )
    if exclude_enrollment_id is not None:
        stmt = stmt.where(Enrollment.id != exclude_enrollment_id)
    if db.scalars(stmt).first() is not None:
        raise ApiError(409, "DUPLICATE_STUDENT_NO", "学号已被本班其他同学使用")


def _new_mk(db: Session, school_id: UUID) -> str:
    while True:
        mk = "S" + secrets.token_hex(4).upper()
        taken = db.scalars(
            select(Student.id).where(Student.school_id == school_id, Student.mk == mk)
        ).first()
        if taken is None:
            return mk


def _apply_fields(student: Student, data: StudentInput) -> None:
    student.name = data.name
    student.gender = data.gender
    student.student_no = data.student_no
    student.birthdate = data.birthdate
    student.tags = data.tags
    student.boarding = data.boarding
    student.family_structure = data.family_structure
    student.family_note = data.family_note
    student.learning_summary = data.learning_summary
    student.personality = data.personality
    student.note = data.note
    student.health_notes = data.health_notes
    student.contacts = [c.model_dump() for c in data.contacts]


def _target(data: StudentInput) -> tuple[int, int] | None:
    return (data.seat.row, data.seat.col) if data.seat else None


def create_student(
    db: Session,
    cls: SchoolClass,
    data: StudentInput,
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> StudentRecord:
    year = require_active_year(db, cls.school_id)
    check_student_no(db, cls, data.student_no, None)
    target = _target(data)
    plan_placement(db, cls, None, target)
    mk = _new_mk(db, cls.school_id)
    student = Student(school_id=cls.school_id, mk=mk, avatar_seed=mk, name=data.name)
    _apply_fields(student, data)
    db.add(student)
    db.flush()
    enrollment = Enrollment(
        student_id=student.id,
        class_id=cls.id,
        academic_year_id=year.id,
        class_role=data.class_role,
        status="active",
    )
    db.add(enrollment)
    db.flush()
    place_student(db, cls, enrollment, target)
    record(
        db,
        user_id=user_id,
        action="student.create",
        success=True,
        object_type="enrollment",
        object_id=str(enrollment.id),
        request=request,
    )
    db.commit()
    return _record(enrollment, student, _allowed_fields(cls, bindings))


def update_student(
    db: Session,
    cls: SchoolClass,
    enrollment: Enrollment,
    data: StudentInput,
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> StudentRecord:
    student = db.get(Student, enrollment.student_id)
    assert student is not None
    check_student_no(db, cls, data.student_no, enrollment.id)
    target = _target(data)
    plan_placement(db, cls, enrollment, target)
    _apply_fields(student, data)
    enrollment.class_role = data.class_role
    db.flush()
    place_student(db, cls, enrollment, target)
    record(
        db,
        user_id=user_id,
        action="student.update",
        success=True,
        object_type="enrollment",
        object_id=str(enrollment.id),
        request=request,
    )
    db.commit()
    return _record(enrollment, student, _allowed_fields(cls, bindings))


def remove_student(
    db: Session,
    cls: SchoolClass,
    enrollment: Enrollment,
    user_id: UUID,
    request: Request | None,
) -> None:
    enrollment.status = "removed"
    enrollment.left_at = clock.utc_now()
    enrollment.seat_locked = False
    enrollment.seat_row = None
    enrollment.seat_col = None
    db.flush()
    cls.seat_version = SchoolClass.seat_version + 1
    record(
        db,
        user_id=user_id,
        action="student.remove",
        success=True,
        object_type="enrollment",
        object_id=str(enrollment.id),
        request=request,
    )
    db.commit()
