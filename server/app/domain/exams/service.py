from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.audit.service import deny, record
from app.domain.classes.service import class_scope_of
from app.domain.exams.schemas import ExamInput, ExamOut, Progress, SubjectFull
from app.domain.exams.subjects import merge_subjects
from app.domain.schools.service import require_active_year
from app.errors import ApiError
from app.models import Enrollment, Exam, SchoolClass, Score
from app.rbac.bindings import Binding, visible_subjects, writable_subjects


def _visible_of(exam: Exam, visible: frozenset[str] | None) -> list[SubjectFull]:
    return [SubjectFull(**s) for s in exam.subjects if visible is None or s["name"] in visible]


def _entered_counts(
    db: Session, class_id: UUID, exams: Sequence[Exam], visible: frozenset[str] | None
) -> dict[UUID, int]:
    """Active enrollments with a score row for every visible subject, per exam (one query)."""
    needed = {e.id: len(_visible_of(e, visible)) for e in exams}
    if not exams:
        return {}
    stmt = (
        select(Score.exam_id, Score.enrollment_id, func.count(func.distinct(Score.subject)))
        .join(Enrollment, Enrollment.id == Score.enrollment_id)
        .where(
            Score.exam_id.in_(needed),
            Enrollment.class_id == class_id,
            Enrollment.status == "active",
        )
        .group_by(Score.exam_id, Score.enrollment_id)
    )
    if visible is not None:
        stmt = stmt.where(Score.subject.in_(visible))
    entered = dict.fromkeys(needed, 0)
    for exam_id, _, n in db.execute(stmt):
        if n >= needed[exam_id] > 0:
            entered[exam_id] += 1
    return entered


def _total(db: Session, class_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Enrollment)
            .where(Enrollment.class_id == class_id, Enrollment.status == "active")
        )
        or 0
    )


def _outs(
    db: Session,
    cls: SchoolClass,
    exams: Sequence[Exam],
    visible: frozenset[str] | None,
    user_id: UUID,
) -> list[ExamOut]:
    total = _total(db, cls.id)
    entered = _entered_counts(db, cls.id, exams, visible)
    return [
        ExamOut(
            id=e.id,
            name=e.name,
            exam_type=e.exam_type,
            date=e.date,
            subjects=_visible_of(e, visible),
            created_by_me=e.created_by_user_id == user_id,
            progress=Progress(entered=entered[e.id], total=total),
        )
        for e in exams
    ]


def exam_out(db: Session, exam: Exam, visible: frozenset[str] | None, user_id: UUID) -> ExamOut:
    cls = db.get(SchoolClass, exam.class_id)
    assert cls is not None
    return _outs(db, cls, [exam], visible, user_id)[0]


def list_exams(
    db: Session, cls: SchoolClass, bindings: Sequence[Binding], user_id: UUID
) -> list[ExamOut]:
    visible = visible_subjects(bindings, class_scope_of(cls))
    exams = db.scalars(
        select(Exam)
        .where(Exam.class_id == cls.id)
        .order_by(Exam.date.desc(), Exam.created_at.desc(), Exam.id)
    ).all()
    if visible is not None:
        exams = [e for e in exams if any(s["name"] in visible for s in e.subjects)]
    return _outs(db, cls, exams, visible, user_id)


def get_visible_exam(
    db: Session, cls: SchoolClass, exam_id: UUID, bindings: Sequence[Binding]
) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None or exam.class_id != cls.id:
        raise ApiError(404, "NOT_FOUND", "考试不存在")
    visible = visible_subjects(bindings, class_scope_of(cls))
    if visible is not None and not any(s["name"] in visible for s in exam.subjects):
        raise ApiError(404, "NOT_FOUND", "考试不存在")
    return exam


def ensure_exam_owner(
    db: Session,
    request: Request | None,
    user_id: UUID,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    exam: Exam,
) -> None:
    """Subject teachers (no broader binding in this class) may only change exams they created."""
    if writable_subjects(bindings, class_scope_of(cls)) is None:
        return
    if exam.created_by_user_id != user_id:
        deny(
            db,
            user_id=user_id,
            action="exam.write",
            object_type="exam",
            object_id=str(exam.id),
            request=request,
        )


def _check_subjects_allowed(cls: SchoolClass, data: ExamInput, bindings: Sequence[Binding]) -> None:
    allowed = writable_subjects(bindings, class_scope_of(cls))
    if allowed is None:
        return
    for s in data.subjects:
        if s.name not in allowed:
            raise ApiError(
                400, "SUBJECT_NOT_ALLOWED", "只能操作自己任教的科目", {"subject": s.name}
            )


def create_exam(
    db: Session,
    cls: SchoolClass,
    data: ExamInput,
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> ExamOut:
    _check_subjects_allowed(cls, data, bindings)
    year = require_active_year(db, cls.school_id)
    exam = Exam(
        class_id=cls.id,
        academic_year_id=year.id,
        name=data.name,
        exam_type=data.exam_type,
        date=data.date,
        subjects=[s.model_dump() for s in data.subjects],
        created_by_user_id=user_id,
    )
    db.add(exam)
    db.flush()
    merge_subjects(db, cls, data.subjects)
    record(
        db,
        user_id=user_id,
        action="exam.create",
        success=True,
        object_type="exam",
        object_id=str(exam.id),
        request=request,
    )
    db.commit()
    return exam_out(db, exam, visible_subjects(bindings, class_scope_of(cls)), user_id)


def update_exam(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    data: ExamInput,
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> ExamOut:
    _check_subjects_allowed(cls, data, bindings)
    for s in data.subjects:
        top = db.scalar(
            select(func.max(Score.value)).where(Score.exam_id == exam.id, Score.subject == s.name)
        )
        if top is not None and s.full < top:
            raise ApiError(
                400, "FULL_BELOW_SCORES", "满分不能低于已录入的最高分", {"subject": s.name}
            )
    kept = {s.name for s in data.subjects}
    removed = [s["name"] for s in exam.subjects if s["name"] not in kept]
    if removed:
        db.execute(delete(Score).where(Score.exam_id == exam.id, Score.subject.in_(removed)))
    exam.name = data.name
    exam.exam_type = data.exam_type
    exam.date = data.date
    exam.subjects = [s.model_dump() for s in data.subjects]
    merge_subjects(db, cls, data.subjects)
    record(
        db,
        user_id=user_id,
        action="exam.update",
        success=True,
        object_type="exam",
        object_id=str(exam.id),
        request=request,
    )
    db.commit()
    return exam_out(db, exam, visible_subjects(bindings, class_scope_of(cls)), user_id)


def delete_exam(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> None:
    exam_id = str(exam.id)
    db.delete(exam)  # scores go with it (ON DELETE CASCADE)
    record(
        db,
        user_id=user_id,
        action="exam.delete",
        success=True,
        object_type="exam",
        object_id=exam_id,
        request=request,
    )
    db.commit()
