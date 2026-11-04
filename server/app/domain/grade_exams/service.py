from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.exams.schemas import SubjectFull
from app.domain.exams.service import subject_full_below_scores
from app.domain.exams.subjects import merge_subjects
from app.domain.grade_exams.schemas import (
    GradeExamClass,
    GradeExamInput,
    GradeExamOut,
    MissingClass,
)
from app.domain.schools.service import active_academic_year, require_active_year
from app.errors import ApiError
from app.models import AcademicYear, Enrollment, Exam, Grade, GradeExam, SchoolClass, Score, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import LEADER_ROLES, Perm


def get_grade_in_school(db: Session, school_id: UUID, grade_id: UUID) -> Grade:
    grade = db.get(Grade, grade_id)
    if grade is None or grade.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "年级不存在")
    return grade


def get_grade_exam(
    db: Session, school_id: UUID, grade_exam_id: UUID, *, lock: bool = False
) -> GradeExam:
    """``lock`` takes the row FOR UPDATE: update / delete / sync serialise per grade exam."""
    if lock:
        ge = db.get(GradeExam, grade_exam_id, with_for_update=True, populate_existing=True)
    else:
        ge = db.get(GradeExam, grade_exam_id)
    if ge is None or ge.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "联考不存在")
    year = active_academic_year(db, school_id)
    if year is None or ge.academic_year_id != year.id:  # 往年联考视为不存在
        raise ApiError(404, "NOT_FOUND", "联考不存在")
    return ge


def _grade_classes(db: Session, ge: GradeExam) -> list[SchoolClass]:
    """Active classes of the grade in the grade exam's year, by name."""
    return list(
        db.scalars(
            select(SchoolClass)
            .where(
                SchoolClass.school_id == ge.school_id,
                SchoolClass.academic_year_id == ge.academic_year_id,
                SchoolClass.grade_id == ge.grade_id,
                SchoolClass.active.is_(True),
            )
            .order_by(SchoolClass.name, SchoolClass.id)
        ).all()
    )


def _new_exam(ge: GradeExam, cls: SchoolClass, user_id: UUID, now: datetime) -> Exam:
    return Exam(
        class_id=cls.id,
        academic_year_id=ge.academic_year_id,
        grade_exam_id=ge.id,
        name=ge.name,
        exam_type=ge.exam_type,
        date=ge.date,
        subjects=[dict(s) for s in ge.subjects],
        created_by_user_id=user_id,
        created_at=now,
        updated_at=now,
    )


def progress(db: Session, ge: GradeExam) -> list[GradeExamClass]:
    """One row per class that has the exam; entered cells / expected cells in three queries."""
    rows = db.execute(
        select(Exam.id, SchoolClass.id, SchoolClass.name)
        .join(SchoolClass, SchoolClass.id == Exam.class_id)
        .where(Exam.grade_exam_id == ge.id)
        .order_by(SchoolClass.name, SchoolClass.id)
    ).all()
    if not rows:
        return []
    names = [s["name"] for s in ge.subjects]
    entered = dict(
        db.execute(
            select(Score.exam_id, func.count())
            .join(Enrollment, Enrollment.id == Score.enrollment_id)
            .where(
                Score.exam_id.in_([r[0] for r in rows]),
                Score.subject.in_(names),
                Enrollment.status == "active",
            )
            .group_by(Score.exam_id)
        ).all()
    )
    students = dict(
        db.execute(
            select(Enrollment.class_id, func.count())
            .where(Enrollment.class_id.in_([r[1] for r in rows]), Enrollment.status == "active")
            .group_by(Enrollment.class_id)
        ).all()
    )
    return [
        GradeExamClass(
            class_id=class_id,
            class_name=class_name,
            exam_id=exam_id,
            entered=entered.get(exam_id, 0),
            expected=students.get(class_id, 0) * len(names),
        )
        for exam_id, class_id, class_name in rows
    ]


def _missing_classes(db: Session, ge: GradeExam) -> list[SchoolClass]:
    have = set(db.scalars(select(Exam.class_id).where(Exam.grade_exam_id == ge.id)).all())
    return [c for c in _grade_classes(db, ge) if c.id not in have]


def grade_exam_out(db: Session, ge: GradeExam) -> GradeExamOut:
    grade = db.get(Grade, ge.grade_id)
    assert grade is not None
    return GradeExamOut(
        id=ge.id,
        grade_id=ge.grade_id,
        grade_name=grade.name,
        name=ge.name,
        exam_type=ge.exam_type,
        date=ge.date,
        subjects=[SubjectFull(**s) for s in ge.subjects],
        classes=progress(db, ge),
        missing_classes=[
            MissingClass(class_id=c.id, class_name=c.name) for c in _missing_classes(db, ge)
        ],
    )


def _visible_grade_ids(bindings: Sequence[Binding], year: AcademicYear) -> set[UUID] | None:
    """school.view 可见的年级:None = 全校;否则只含领导身份绑定的年级。"""
    leaders = [b for b in bindings if b.role in LEADER_ROLES]
    if can(leaders, Perm.CLASS_READ, Scope(school_id=year.school_id)):
        return None
    return {b.scope.grade_id for b in leaders if b.scope.grade_id is not None}


def list_grade_exams(
    db: Session, bindings: Sequence[Binding], year: AcademicYear, grade_id: UUID | None
) -> list[GradeExamOut]:
    stmt = (
        select(GradeExam)
        .where(GradeExam.school_id == year.school_id, GradeExam.academic_year_id == year.id)
        .order_by(GradeExam.date.desc(), GradeExam.created_at.desc(), GradeExam.id)
    )
    visible = _visible_grade_ids(bindings, year)
    if visible is not None:
        stmt = stmt.where(GradeExam.grade_id.in_(visible))
    if grade_id is not None:
        stmt = stmt.where(GradeExam.grade_id == grade_id)
    return [grade_exam_out(db, ge) for ge in db.scalars(stmt).all()]


def _lock_class_exams(db: Session, ge: GradeExam) -> list[Exam]:
    return list(
        db.scalars(
            select(Exam)
            .where(Exam.grade_exam_id == ge.id)
            .order_by(Exam.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )


def _scored_subjects(db: Session, exam_ids: Sequence[UUID], names: Sequence[str]) -> set[str]:
    """Subjects with at least one entered cell (absent included) in any of the exams."""
    if not exam_ids or not names:
        return set()
    return set(
        db.scalars(
            select(Score.subject)
            .where(Score.exam_id.in_(exam_ids), Score.subject.in_(names))
            .distinct()
        ).all()
    )


def _ensure_unscored(db: Session, exams: Sequence[Exam]) -> None:
    if db.scalar(select(Score.id).where(Score.exam_id.in_([e.id for e in exams])).limit(1)):
        raise ApiError(409, "EXAM_HAS_SCORES", "已有班级录入了成绩,不能删除")


def create(
    db: Session,
    user: User,
    body: GradeExamInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    grade = get_grade_in_school(db, user.school_id, body.grade_id)
    year = require_active_year(db, user.school_id)
    if grade.academic_year_id != year.id:
        raise ApiError(400, "BAD_REQUEST", "只能给当前学年的年级建联考")
    ge = GradeExam(
        school_id=user.school_id,
        academic_year_id=year.id,
        grade_id=grade.id,
        name=body.name,
        exam_type=body.exam_type,
        date=body.date,
        subjects=[s.model_dump() for s in body.subjects],
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(ge)
    db.flush()
    classes = _grade_classes(db, ge)
    for cls in classes:
        db.add(_new_exam(ge, cls, user.id, now))
        merge_subjects(db, cls, body.subjects)
    record(
        db,
        user_id=user.id,
        action="exam.grade_create",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
        extra={"classes": len(classes)},
    )
    db.commit()
    return grade_exam_out(db, ge)


def update(
    db: Session,
    user: User,
    ge: GradeExam,
    body: GradeExamInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    """``ge`` must already be locked (get_grade_exam(lock=True)) and permission-checked."""
    if body.grade_id != ge.grade_id:
        raise ApiError(400, "BAD_REQUEST", "联考不能更换年级")
    exams = _lock_class_exams(db, ge)
    kept = {s.name for s in body.subjects}
    removed = [s["name"] for s in ge.subjects if s["name"] not in kept]
    scored = _scored_subjects(db, [e.id for e in exams], removed)
    for name in removed:  # 按联考原有科目顺序,报第一个
        if name in scored:
            raise ApiError(409, "EXAM_HAS_SCORES", "该科目已有成绩,不能去掉", {"subject": name})
    for e in exams:
        below = subject_full_below_scores(db, e, body.subjects)
        if below is not None:
            raise ApiError(
                409, "SCORE_ABOVE_FULL", "满分不能低于已录入的最高分", {"subject": below}
            )
    subjects = [s.model_dump() for s in body.subjects]
    ge.name, ge.exam_type, ge.date, ge.subjects = body.name, body.exam_type, body.date, subjects
    ge.updated_at = now
    classes = {
        c.id: c
        for c in db.scalars(
            select(SchoolClass).where(SchoolClass.id.in_([e.class_id for e in exams]))
        )
    }
    for e in exams:
        e.name, e.exam_type, e.date = body.name, body.exam_type, body.date
        e.subjects = [dict(s) for s in subjects]
        e.updated_at = now
        merge_subjects(db, classes[e.class_id], body.subjects)
    record(
        db,
        user_id=user.id,
        action="exam.grade_update",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
    )
    db.commit()
    return grade_exam_out(db, ge)


def delete_grade_exam(
    db: Session, user: User, ge: GradeExam, *, request: Request | None = None
) -> None:
    exams = _lock_class_exams(db, ge)
    if exams:
        _ensure_unscored(db, exams)
    grade_exam_id = str(ge.id)
    db.execute(delete(Exam).where(Exam.grade_exam_id == ge.id))
    db.delete(ge)
    record(
        db,
        user_id=user.id,
        action="exam.grade_delete",
        success=True,
        object_type="grade_exam",
        object_id=grade_exam_id,
        request=request,
        extra={"classes": len(exams)},
    )
    db.commit()


def sync(
    db: Session,
    user: User,
    ge: GradeExam,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    missing = _missing_classes(db, ge)
    for cls in missing:
        db.add(_new_exam(ge, cls, user.id, now))
        merge_subjects(db, cls, [SubjectFull(**s) for s in ge.subjects])
    record(
        db,
        user_id=user.id,
        action="exam.grade_sync",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
        extra={"created": len(missing)},
    )
    db.commit()
    return grade_exam_out(db, ge)
