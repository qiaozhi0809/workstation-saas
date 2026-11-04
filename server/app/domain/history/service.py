from collections.abc import Sequence
from typing import NoReturn
from uuid import UUID

from fastapi import Request
from sqlalchemy import column, func, select, table
from sqlalchemy.orm import Session

from app.ai.stats import exam_table
from app.audit.service import deny
from app.domain.classes.service import class_scope_of
from app.domain.exams.schemas import SubjectFull
from app.domain.history.schemas import (
    HistoryClass,
    HistoryExam,
    HistoryRoster,
    HistoryScoreRow,
    HistoryScores,
    HistoryStudent,
    HistoryYear,
)
from app.domain.overview.service import SCHOOL_VIEW
from app.domain.schools.service import active_academic_year
from app.errors import ApiError
from app.models import AcademicYear, Enrollment, Exam, Grade, SchoolClass, Score, Student, User
from app.rbac.bindings import Binding, can
from app.rbac.roles import LEADER_ROLES, Perm

_teachers = table("teachers", column("id"), column("user_id"))


def _leader_bindings(bindings: Sequence[Binding]) -> list[Binding]:
    """往年班和看全校同一口径,只认领导身份;不跨模块导入 overview 的私有函数。"""
    return [b for b in bindings if b.role in LEADER_ROLES]


def _visible_to(bindings: Sequence[Binding], cls: SchoolClass) -> bool:
    return can(_leader_bindings(bindings), Perm.CLASS_READ, class_scope_of(cls))


def _deny(
    db: Session, request: Request | None, user: User, object_type: str, object_id: UUID
) -> NoReturn:
    deny(
        db,
        user_id=user.id,
        action=SCHOOL_VIEW,
        object_type=object_type,
        object_id=str(object_id),
        request=request,
    )


def past_years(db: Session, school_id: UUID) -> list[HistoryYear]:
    """本校非当前学年,开学日期倒序。"""
    rows = db.scalars(
        select(AcademicYear)
        .where(AcademicYear.school_id == school_id, AcademicYear.is_active.is_(False))
        .order_by(AcademicYear.start_date.desc(), AcademicYear.id)
    ).all()
    return [
        HistoryYear(id=y.id, name=y.name, start_date=y.start_date, end_date=y.end_date)
        for y in rows
    ]


def past_classes(
    db: Session, user: User, bindings: Sequence[Binding], year_id: UUID
) -> list[HistoryClass]:
    """某往年学年调用者可见的班;往年班升级后 active = false,所以不按 active 过滤。"""
    year = db.scalars(
        select(AcademicYear).where(
            AcademicYear.id == year_id,
            AcademicYear.school_id == user.school_id,
            AcademicYear.is_active.is_(False),
        )
    ).one_or_none()
    if year is None:
        raise ApiError(404, "YEAR_NOT_FOUND", "没有找到该学年")
    rows = db.execute(
        select(SchoolClass, Grade.name, User.display_name)
        .join(Grade, Grade.id == SchoolClass.grade_id)
        .outerjoin(_teachers, _teachers.c.id == SchoolClass.homeroom_teacher_id)
        .outerjoin(User, User.id == _teachers.c.user_id)
        .where(SchoolClass.school_id == user.school_id, SchoolClass.academic_year_id == year.id)
        .order_by(Grade.display_order, Grade.name, SchoolClass.name, SchoolClass.id)
    ).all()
    visible = [(cls, grade, name) for cls, grade, name in rows if _visible_to(bindings, cls)]
    counts: dict[UUID, int] = {}
    if visible:
        counts = dict(
            db.execute(
                select(Enrollment.class_id, func.count())
                .where(
                    Enrollment.class_id.in_([c.id for c, _, _ in visible]),
                    Enrollment.status != "removed",
                )
                .group_by(Enrollment.class_id)
            ).all()
        )
    return [
        HistoryClass(
            class_id=cls.id,
            class_name=cls.name,
            grade_name=grade,
            homeroom_name=name,
            students=counts.get(cls.id, 0),
        )
        for cls, grade, name in visible
    ]


def _past_class_or_deny(
    db: Session,
    request: Request | None,
    user: User,
    bindings: Sequence[Binding],
    class_id: UUID,
) -> SchoolClass:
    """班存在、属于本校、不属于当前学年、调用者可见;任一不满足一律 403 + 审计。"""
    cls = db.get(SchoolClass, class_id)
    current = active_academic_year(db, user.school_id)
    if (
        cls is None
        or cls.school_id != user.school_id
        or (current is not None and cls.academic_year_id == current.id)
        or not _visible_to(bindings, cls)
    ):
        _deny(db, request, user, "class", class_id)
    return cls


def class_students(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    request: Request | None = None,
) -> HistoryRoster:
    cls = _past_class_or_deny(db, request, user, bindings, class_id)
    rows = db.execute(
        select(Student.id, Student.name, Student.student_no, Enrollment.status)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(Enrollment.class_id == cls.id, Enrollment.status != "removed")
        .order_by(Student.student_no.asc().nulls_last(), Student.mk)
    ).all()
    return HistoryRoster(
        students=[
            HistoryStudent(student_id=sid, name=name, student_no=no, status=status)
            for sid, name, no, status in rows
        ]
    )


def _to_exam(e: Exam) -> HistoryExam:
    return HistoryExam(
        id=e.id,
        name=e.name,
        exam_type=e.exam_type,  # type: ignore[arg-type]
        date=e.date,
        subjects=[SubjectFull(**s) for s in e.subjects],
    )


def class_exams(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    request: Request | None = None,
) -> list[HistoryExam]:
    cls = _past_class_or_deny(db, request, user, bindings, class_id)
    exams = db.scalars(
        select(Exam)
        .where(Exam.class_id == cls.id)
        .order_by(Exam.date.desc(), Exam.created_at.desc(), Exam.id)
    ).all()
    return [_to_exam(e) for e in exams]


def exam_scores(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    exam_id: UUID,
    request: Request | None = None,
) -> HistoryScores:
    exam = db.get(Exam, exam_id)
    if exam is None:
        _deny(db, request, user, "exam", exam_id)
    cls = _past_class_or_deny(db, request, user, bindings, exam.class_id)
    # ids 先按 Student.mk 排序,同分并列时顺序才确定
    people = db.execute(
        select(Enrollment.id, Student.id, Student.name, Student.student_no)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id == cls.id, Enrollment.status != "removed")
        .order_by(Student.mk)
    ).all()
    by_enrollment = {eid: (sid, name, no) for eid, sid, name, no in people}
    scores: dict[UUID, dict[str, float | None]] = {}
    for eid, subject, value in db.execute(
        select(Score.enrollment_id, Score.subject, Score.value).where(Score.exam_id == exam.id)
    ):
        scores.setdefault(eid, {})[subject] = value
    subjects = [SubjectFull(**s) for s in exam.subjects]
    rows = exam_table(subjects, scores, [eid for eid, *_ in people])
    return HistoryScores(
        exam=_to_exam(exam),
        students=[
            HistoryScoreRow(
                student_id=by_enrollment[r.enrollment_id][0],
                name=by_enrollment[r.enrollment_id][1],
                student_no=by_enrollment[r.enrollment_id][2],
                scores=r.subs,
                total=r.total,
                class_rank=r.rank,
            )
            for r in rows
        ],
    )
