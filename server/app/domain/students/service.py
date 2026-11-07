from collections.abc import Sequence
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy import text as sql
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import record
from app.domain.students.schemas import StudentProfile, StudentSeat, TeacherNote
from app.errors import ApiError
from app.models import Enrollment, Exam, SchoolClass, Student
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
        Perm.STUDENT_BASIC: ("gender", "student_no", "birthdate", "avatar_seed", "boarding"),
        Perm.STUDENT_FAMILY: ("family_structure", "family_note", "contacts"),
        Perm.STUDENT_LEARNING: ("learning_summary",),
        Perm.STUDENT_PROFILE: ("personality", "health_notes", "tags", "note"),
    }
    for perm, fields in groups.items():
        if can(bindings, perm, scope):
            for f in fields:
                data[f] = _clean(getattr(student, f))
    if can(bindings, Perm.TEACHER_NOTES, scope) and isinstance(student.teacher_notes, dict):
        mine = student.teacher_notes.get(str(caller_id))
        if isinstance(mine, dict) and isinstance(mine.get("text"), str):
            data["teacher_notes"] = {
                "text": mine["text"],
                "updated_at": mine.get("updated_at") or student.updated_at,
            }
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


def exam_roster_ids(db: Session, exam: Exam, current_year: bool) -> list[UUID]:
    """这场考试参与名次 / 平均 / 最高的注册 id,家长端与教师端同一口径(L76 / L278):
    当前学年的班只算在读注册(与 active_enrollments 同一筛选),往年的班算全部未删除的注册
    (history.exam_scores);被移出 / 转出的注册都不算。按 Student.mk 排序,同分并列的顺序确定。"""
    enrolled = Enrollment.status == "active" if current_year else Enrollment.status != "removed"
    return list(
        db.scalars(
            select(Enrollment.id)
            .join(Student, Student.id == Enrollment.student_id)
            .where(Enrollment.class_id == exam.class_id, enrolled)
            .order_by(Student.mk)
        )
    )


def save_my_notes(
    db: Session, student: Student, user_id: UUID, text: str, request: Request | None
) -> TeacherNote:
    now = clock.utc_now()
    text = text.strip()
    # 原子更新单个作者的键,并发的其他老师的笔记不会被整体覆盖
    if text:
        db.execute(
            sql(
                "UPDATE students SET teacher_notes = coalesce(teacher_notes, '{}'::jsonb) || "
                "jsonb_build_object(CAST(:uid AS text), jsonb_build_object("
                "'text', CAST(:text AS text), 'updated_at', CAST(:ts AS text))) WHERE id = :sid"
            ),
            {"uid": str(user_id), "text": text, "ts": now.isoformat(), "sid": student.id},
        )
    else:
        db.execute(
            sql(
                "UPDATE students SET teacher_notes = "
                "coalesce(teacher_notes, '{}'::jsonb) - CAST(:uid AS text) WHERE id = :sid"
            ),
            {"uid": str(user_id), "sid": student.id},
        )
    db.expire(student, ["teacher_notes"])
    record(
        db,
        user_id=user_id,
        action="student.write_notes",
        success=True,
        object_type="student",
        object_id=str(student.id),
        request=request,
    )
    db.commit()
    return TeacherNote(text=text, updated_at=now)
