from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny, record
from app.domain.classes.service import class_scope_of
from app.domain.exams.schemas import (
    ExamInput,
    ExamOut,
    Gradebook,
    GradebookExam,
    Progress,
    ScoreCellIn,
    ScoreSheet,
    ScoreSheetItem,
    SubjectFull,
)
from app.domain.exams.subjects import merge_subjects
from app.domain.schools.service import require_active_year
from app.domain.students.service import active_enrollments
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
            grade_exam_id=e.grade_exam_id,
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
    db: Session,
    cls: SchoolClass,
    exam_id: UUID,
    bindings: Sequence[Binding],
    *,
    lock: bool = False,
) -> Exam:
    """``lock`` takes the row FOR UPDATE: score writes / exam edits / deletes serialise per exam."""
    if lock:
        exam = db.get(Exam, exam_id, with_for_update=True, populate_existing=True)
    else:
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


def ensure_exam_deletable(
    db: Session,
    request: Request | None,
    user_id: UUID,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    exam: Exam,
) -> None:
    """A subject teacher may not delete an exam that holds subjects they cannot write."""
    writable = writable_subjects(bindings, class_scope_of(cls))
    if writable is None:
        return
    if any(s["name"] not in writable for s in exam.subjects):
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


def subject_full_below_scores(
    db: Session, exam: Exam, subjects: Sequence[SubjectFull]
) -> str | None:
    """First subject whose new full mark is below the highest score already entered, or None."""
    for s in subjects:
        top = db.scalar(
            select(func.max(Score.value))
            .join(Enrollment, Enrollment.id == Score.enrollment_id)
            .where(
                Score.exam_id == exam.id,
                Score.subject == s.name,
                Enrollment.status == "active",
            )
        )
        if top is not None and s.full < top:
            return s.name
    return None


def ensure_not_grade_managed(exam: Exam) -> None:
    """Exams fanned out from a grade-wide exam are edited only through the grade exam."""
    if exam.grade_exam_id is not None:
        raise ApiError(409, "EXAM_MANAGED_BY_GRADE", "这是年级联考,由教导处修改")


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
    # 先锁班级行并合并科目:班级在路由检查之后被并发删掉时这里 404,而不是插入 exams 时撞外键 500
    merge_subjects(db, cls, data.subjects)
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
    writable = writable_subjects(bindings, class_scope_of(cls))
    below = subject_full_below_scores(db, exam, data.subjects)
    if below is not None:
        raise ApiError(400, "FULL_BELOW_SCORES", "满分不能低于已录入的最高分", {"subject": below})
    requested = {s.name: s.model_dump() for s in data.subjects}
    existing = list(exam.subjects)
    # 只有可写科目参与增删;不可写(看不见)的科目原样保留在原位置
    new_subjects = [
        e if (writable is not None and e["name"] not in writable) else requested[e["name"]]
        for e in existing
        if (writable is not None and e["name"] not in writable) or e["name"] in requested
    ]
    present = {e["name"] for e in existing}
    new_subjects += [v for n, v in requested.items() if n not in present]
    if writable is None:
        new_subjects = [s.model_dump() for s in data.subjects]
    removed = [
        e["name"]
        for e in existing
        if (writable is None or e["name"] in writable) and e["name"] not in requested
    ]
    if removed:
        db.execute(delete(Score).where(Score.exam_id == exam.id, Score.subject.in_(removed)))
    exam.name = data.name
    exam.exam_type = data.exam_type
    exam.date = data.date
    exam.subjects = new_subjects
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


def _scores_by_enrollment(
    db: Session,
    exam_ids: Sequence[UUID],
    enrollment_ids: set[UUID],
    allowed: dict[UUID, set[str]],
) -> dict[UUID, dict[UUID, dict[str, float | None]]]:
    """exam_id -> enrollment_id -> subject -> value (active enrollments, allowed subjects)."""
    out: dict[UUID, dict[UUID, dict[str, float | None]]] = {e: {} for e in exam_ids}
    if not exam_ids or not enrollment_ids:
        return out
    rows = db.execute(
        select(Score.exam_id, Score.enrollment_id, Score.subject, Score.value).where(
            Score.exam_id.in_(exam_ids), Score.enrollment_id.in_(enrollment_ids)
        )
    )
    for exam_id, enrollment_id, subject, value in rows:
        if subject in allowed[exam_id]:
            out[exam_id].setdefault(enrollment_id, {})[subject] = value
    return out


def _allowed_names(exam: Exam, visible: frozenset[str] | None) -> set[str]:
    return {s.name for s in _visible_of(exam, visible)}


def score_sheet(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    visible: frozenset[str] | None,
    user_id: UUID,
) -> ScoreSheet:
    enrollments = active_enrollments(db, cls.id)
    scores = _scores_by_enrollment(
        db, [exam.id], {e.id for e in enrollments}, {exam.id: _allowed_names(exam, visible)}
    )[exam.id]
    return ScoreSheet(
        exam=exam_out(db, exam, visible, user_id),
        items=[
            ScoreSheetItem(enrollment_id=e.id, scores=scores.get(e.id, {})) for e in enrollments
        ],
    )


def export_scores(
    db: Session, cls: SchoolClass, exam: Exam, user_id: UUID, request: Request | None
) -> ScoreSheet:
    sheet = score_sheet(db, cls, exam, None, user_id)
    record(
        db,
        user_id=user_id,
        action="score.export",
        success=True,
        object_type="exam",
        object_id=str(exam.id),
        request=request,
    )
    db.commit()
    return sheet


def _validate_cell(cell: ScoreCellIn, exam: Exam, active: set[UUID], writable) -> None:
    if cell.enrollment_id not in active:
        raise ApiError(400, "UNKNOWN_ENROLLMENT", "学生不在本班")
    full = {s["name"]: s["full"] for s in exam.subjects}
    if cell.subject not in full:
        raise ApiError(400, "UNKNOWN_SUBJECT", "考试没有这个科目", {"subject": cell.subject})
    if writable is not None and cell.subject not in writable:
        raise ApiError(
            400, "SUBJECT_NOT_ALLOWED", "只能操作自己任教的科目", {"subject": cell.subject}
        )
    v = cell.value
    if isinstance(v, float) and not (0 <= v <= full[cell.subject] and round(v, 1) == v):
        raise ApiError(
            400,
            "SCORE_INVALID",
            "分数不合法",
            {"enrollment_id": str(cell.enrollment_id), "subject": cell.subject},
        )


def save_scores(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    cells: Sequence[ScoreCellIn],
    user_id: UUID,
    bindings: Sequence[Binding],
    request: Request | None,
) -> int:
    active = {e.id for e in active_enrollments(db, cls.id)}
    writable = writable_subjects(bindings, class_scope_of(cls))
    for cell in cells:
        _validate_cell(cell, exam, active, writable)
    final = {(c.enrollment_id, c.subject): c.value for c in cells}  # last one wins
    now = clock.utc_now()
    clears = [k for k, v in final.items() if v is None]
    for enrollment_id, subject in clears:
        db.execute(
            delete(Score).where(
                Score.exam_id == exam.id,
                Score.enrollment_id == enrollment_id,
                Score.subject == subject,
            )
        )
    upserts = [
        {
            "exam_id": exam.id,
            "enrollment_id": k[0],
            "subject": k[1],
            "value": None if v == "absent" else v,
            "entered_by_user_id": user_id,
            "entered_at": now,
        }
        for k, v in final.items()
        if v is not None
    ]
    if upserts:
        stmt = pg_insert(Score).values(upserts)
        db.execute(
            stmt.on_conflict_do_update(
                index_elements=["exam_id", "enrollment_id", "subject"],
                set_={
                    "value": stmt.excluded.value,
                    "entered_by_user_id": stmt.excluded.entered_by_user_id,
                    "entered_at": stmt.excluded.entered_at,
                },
            )
        )
    record(
        db,
        user_id=user_id,
        action="score.write",
        success=True,
        object_type="exam",
        object_id=str(exam.id),
        request=request,
        extra={"cells": len(final)},
    )
    db.commit()
    return len(final)


def gradebook(
    db: Session, cls: SchoolClass, bindings: Sequence[Binding], user_id: UUID
) -> Gradebook:
    visible = visible_subjects(bindings, class_scope_of(cls))
    exams = list(
        db.scalars(
            select(Exam)
            .where(Exam.class_id == cls.id)
            .order_by(Exam.date, Exam.created_at, Exam.id)
        ).all()
    )
    if visible is not None:
        exams = [e for e in exams if any(s["name"] in visible for s in e.subjects)]
    enrollment_ids = {e.id for e in active_enrollments(db, cls.id)}
    scores = _scores_by_enrollment(
        db, [e.id for e in exams], enrollment_ids, {e.id: _allowed_names(e, visible) for e in exams}
    )
    outs = _outs(db, cls, exams, visible, user_id)
    return Gradebook(
        exams=[
            GradebookExam(
                **out.model_dump(),
                scores={str(k): v for k, v in scores[e.id].items()},
            )
            for e, out in zip(exams, outs, strict=True)
        ]
    )
