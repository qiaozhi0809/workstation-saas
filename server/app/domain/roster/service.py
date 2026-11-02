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
from app.domain.roster.schemas import (
    SkippedRow,
    StudentImport,
    StudentImported,
    StudentImportRow,
    StudentInput,
    StudentRecord,
)
from app.domain.roster.seats import first_empty_seat, lock_class, place_student, plan_placement
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


def _apply_fields(student: Student, data: StudentImportRow) -> None:
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
    lock_class(db, cls)
    year = require_active_year(db, cls.school_id)
    check_student_no(db, cls, data.student_no, None)
    target = _target(data)
    plan = plan_placement(db, cls, None, target)
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
    place_student(db, cls, enrollment, target, plan)
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
    lock_class(db, cls)
    db.refresh(enrollment)  # seat state may have moved before we got the lock
    if enrollment.status != "active":
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    student = db.get(Student, enrollment.student_id)
    assert student is not None
    check_student_no(db, cls, data.student_no, enrollment.id)
    target = _target(data)
    plan = plan_placement(db, cls, enrollment, target)
    _apply_fields(student, data)
    enrollment.class_role = data.class_role
    db.flush()
    place_student(db, cls, enrollment, target, plan)
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
    lock_class(db, cls)
    db.refresh(enrollment)
    if enrollment.status != "active":
        raise ApiError(404, "NOT_FOUND", "学生不存在")
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


def import_students(
    db: Session,
    cls: SchoolClass,
    data: StudentImport,
    user_id: UUID,
    request: Request | None,
) -> StudentImported:
    lock_class(db, cls)
    year = require_active_year(db, cls.school_id)
    existing = db.execute(
        select(Student.name, Student.student_no, Enrollment.seat_row, Enrollment.seat_col)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
    ).all()
    known: list[tuple[str, str | None]] = [(r.name, r.student_no) for r in existing]
    occupied = {(r.seat_row, r.seat_col) for r in existing if r.seat_row is not None}
    skipped: list[SkippedRow] = []
    created = 0
    placed = 0
    for index, row in enumerate(data.rows):
        if any(
            name == row.name and (row.student_no is None or no == row.student_no)
            for name, no in known
        ):
            skipped.append(SkippedRow(index=index, reason="duplicate"))
            continue
        if row.student_no is not None and any(no == row.student_no for _, no in known):
            skipped.append(SkippedRow(index=index, reason="student_no_taken"))
            continue
        mk = _new_mk(db, cls.school_id)
        student = Student(school_id=cls.school_id, mk=mk, avatar_seed=mk, name=row.name)
        _apply_fields(student, row)
        db.add(student)
        db.flush()
        enrollment = Enrollment(
            student_id=student.id,
            class_id=cls.id,
            academic_year_id=year.id,
            class_role=row.class_role,
            status="active",
        )
        if data.auto_seat:
            seat = first_empty_seat(occupied, cls.seat_rows, cls.seat_cols)
            if seat is not None:
                enrollment.seat_row, enrollment.seat_col = seat
                occupied.add(seat)
                placed += 1
        db.add(enrollment)
        known.append((row.name, row.student_no))
        created += 1
    if placed:
        cls.seat_version = SchoolClass.seat_version + 1
    record(
        db,
        user_id=user_id,
        action="student.import",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={"created": created, "skipped": len(skipped)},
    )
    db.commit()
    return StudentImported(created=created, skipped=skipped)


def export_records(
    db: Session,
    cls: SchoolClass,
    year_id: UUID,
    bindings: Sequence[Binding],
    user_id: UUID,
    request: Request | None,
) -> list[StudentRecord]:
    items = student_records(db, cls, year_id, bindings)
    record(
        db,
        user_id=user_id,
        action="student.export",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
    )
    db.commit()
    return items
