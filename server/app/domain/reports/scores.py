"""Grade exam score reports. Statistics and ranking reuse ``app.ai.stats`` (the M2b rules)."""

import csv
import io
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.stats import ExamStats, _round1, exam_stats, exam_table
from app.audit.service import deny, record
from app.domain.classes.service import class_scope_of
from app.domain.exams.schemas import SubjectFull
from app.domain.grade_exams.service import get_grade_exam
from app.domain.reports.schemas import (
    ClassScoreStat,
    GradeExamBrief,
    GradeScoreStat,
    ScoreStudentRow,
    ScoreSummary,
    SubjectStat,
    TotalStat,
)
from app.models import Enrollment, Exam, Grade, GradeExam, SchoolClass, Score, Student, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import LEADER_ROLES, Perm

READ_ACTION = Perm.EXAM_READ.value
EXPORT_ACTION = "score.export"
BOM = "﻿"
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

Scores = dict[UUID, dict[str, float | None]]


@dataclass
class _Report:
    ge: GradeExam
    grade_name: str
    subjects: list[SubjectFull]
    classes: list[SchoolClass]  # 联考关联的全部班,班名顺序
    visible: list[SchoolClass]  # 其中调用者有 exam.read 的
    roster: dict[UUID, list[tuple[Enrollment, Student]]]  # class_id -> 在读学生(全部关联班)
    scores: Scores  # enrollment_id -> subject -> value


def _load(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_exam_id: UUID,
    *,
    action: str,
    request: Request | None,
) -> _Report:
    """Batch-load the report; 403 + audit when no linked class is visible to the caller
    (a grade exam with no linked class at all is an empty report for whoever can see the grade)."""
    ge = get_grade_exam(db, user.school_id, grade_exam_id)
    classes = list(
        db.scalars(
            select(SchoolClass)
            .join(Exam, Exam.class_id == SchoolClass.id)
            .where(Exam.grade_exam_id == ge.id)
            .order_by(SchoolClass.name, SchoolClass.id)
        ).all()
    )
    leaders = [b for b in bindings if b.role in LEADER_ROLES]  # 兼任班主任等不扩大可见范围
    visible = [c for c in classes if can(leaders, Perm.EXAM_READ, class_scope_of(c))]
    # 没有可见班:联考已关联班级但都看不到 → 403;联考没有任何班级时,看整个年级的人拿到空报表
    grade_viewer = can(leaders, Perm.EXAM_READ, Scope(school_id=ge.school_id, grade_id=ge.grade_id))
    if not visible and (classes or not grade_viewer):
        deny(
            db,
            user_id=user.id,
            action=action,
            object_type="grade_exam",
            object_id=str(ge.id),
            request=request,
        )
    roster: dict[UUID, list[tuple[Enrollment, Student]]] = {c.id: [] for c in classes}
    for enrollment, student in db.execute(
        select(Enrollment, Student)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id.in_(roster), Enrollment.status == "active")
        .order_by(Enrollment.id)
    ):
        roster[enrollment.class_id].append((enrollment, student))
    scores: Scores = {}
    enrollment_ids = [e.id for pairs in roster.values() for e, _ in pairs]
    for enrollment_id, subject, value in db.execute(
        select(Score.enrollment_id, Score.subject, Score.value)
        .join(Exam, Exam.id == Score.exam_id)
        .where(Exam.grade_exam_id == ge.id, Score.enrollment_id.in_(enrollment_ids))
    ):
        scores.setdefault(enrollment_id, {})[subject] = value
    grade = db.get(Grade, ge.grade_id)
    assert grade is not None
    return _Report(
        ge=ge,
        grade_name=grade.name,
        subjects=[SubjectFull(**s) for s in ge.subjects],
        classes=classes,
        visible=visible,
        roster=roster,
        scores=scores,
    )


def _ids(report: _Report, classes: Sequence[SchoolClass]) -> list[UUID]:
    return [e.id for c in classes for e, _ in report.roster[c.id]]


def _total_stat(report: _Report, stats: ExamStats | None) -> TotalStat:
    full = sum(s.full for s in report.subjects)
    if stats is None:
        return TotalStat(full=full, count=0, avg=None, max=None, min=None)
    return TotalStat(full=full, count=stats.n, avg=_round1(stats.avg), max=stats.max, min=stats.min)


def _subject_stats(report: _Report, stats: ExamStats | None, students: int) -> list[SubjectStat]:
    by_name = {s.name: s for s in stats.subjects} if stats else {}
    out: list[SubjectStat] = []
    for sub in report.subjects:
        st = by_name.get(sub.name)
        if st is None:
            out.append(
                SubjectStat(
                    subject=sub.name,
                    full=sub.full,
                    count=0,
                    missing=students,
                    avg=None,
                    max=None,
                    min=None,
                    pass_rate=None,
                    good_rate=None,
                )
            )
            continue
        out.append(
            SubjectStat(
                subject=sub.name,
                full=sub.full,
                count=st.n,
                missing=students - st.n,
                avg=_round1(st.avg),
                max=st.max,
                min=st.min,
                pass_rate=st.pass_rate,
                good_rate=st.good_rate,
            )
        )
    return out


def score_summary(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_exam_id: UUID,
    *,
    request: Request | None = None,
) -> ScoreSummary:
    report = _load(db, user, bindings, grade_exam_id, action=READ_ACTION, request=request)
    classes: list[ClassScoreStat] = []
    for cls in report.visible:
        ids = _ids(report, [cls])
        stats = exam_stats(report.subjects, report.scores, ids)
        classes.append(
            ClassScoreStat(
                class_id=cls.id,
                class_name=cls.name,
                subjects=_subject_stats(report, stats, len(ids)),
                total=_total_stat(report, stats),
            )
        )
    ids = _ids(report, report.visible)
    stats = exam_stats(report.subjects, report.scores, ids)
    return ScoreSummary(
        grade_exam=GradeExamBrief(
            id=report.ge.id,
            name=report.ge.name,
            date=report.ge.date,
            grade_name=report.grade_name,
        ),
        subjects=report.subjects,
        classes=classes,
        grade=GradeScoreStat(
            subjects=_subject_stats(report, stats, len(ids)), total=_total_stat(report, stats)
        ),
    )


def _rows(report: _Report, classes: Sequence[SchoolClass]) -> list[ScoreStudentRow]:
    # 年级名次按联考关联的全部班排(名次真实);只输出 classes 里的行,不返回其他班的分数
    grade_rank = {
        r.enrollment_id: r.rank
        for r in exam_table(report.subjects, report.scores, _ids(report, report.classes))
    }
    rows: list[ScoreStudentRow] = []
    for cls in classes:
        pairs = report.roster[cls.id]
        table = {
            r.enrollment_id: r
            for r in exam_table(report.subjects, report.scores, _ids(report, [cls]))
        }
        for enrollment, student in pairs:
            r = table[enrollment.id]
            rows.append(
                ScoreStudentRow(
                    student_id=student.id,
                    name=student.name,
                    student_no=student.student_no,
                    class_id=cls.id,
                    class_name=cls.name,
                    scores={s.name: r.subs[s.name] for s in report.subjects},
                    total=r.total,
                    class_rank=r.rank,
                    grade_rank=grade_rank[enrollment.id],
                )
            )
    # 年级名次升序,没有名次的在后;同名次按班名、姓名保持稳定
    rows.sort(
        key=lambda x: (x.grade_rank is None, x.grade_rank or 0, x.class_name, x.name, x.student_id)
    )
    return rows


def _students(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_exam_id: UUID,
    class_id: UUID | None,
    *,
    action: str,
    request: Request | None,
) -> tuple[_Report, list[ScoreStudentRow]]:
    report = _load(db, user, bindings, grade_exam_id, action=action, request=request)
    classes = report.visible
    if class_id is not None:
        classes = [c for c in report.visible if c.id == class_id]
        if not classes:  # 不可见、不属于该联考、不存在:同一口径 403
            deny(
                db,
                user_id=user.id,
                action=action,
                object_type="grade_exam",
                object_id=str(report.ge.id),
                request=request,
            )
    return report, _rows(report, classes)


def score_students(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_exam_id: UUID,
    class_id: UUID | None,
    *,
    request: Request | None = None,
) -> list[ScoreStudentRow]:
    return _students(
        db, user, bindings, grade_exam_id, class_id, action=READ_ACTION, request=request
    )[1]


def _cell(value: object) -> str:
    """Spreadsheet-safe text: a leading = + - @ (or tab / CR) would be run as a formula."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def _num(value: float | int | None) -> str:
    return "" if value is None else format(value, "g")


def export_csv(rows: Sequence[ScoreStudentRow], subjects: Sequence[SubjectFull]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(
        ["班级", "学号", "姓名", *(s.name for s in subjects), "总分", "班级名次", "年级名次"]
    )
    for r in rows:
        writer.writerow(
            [
                _cell(r.class_name),
                _cell(r.student_no),
                _cell(r.name),
                *(_num(r.scores.get(s.name)) for s in subjects),
                _num(r.total),
                _num(r.class_rank),
                _num(r.grade_rank),
            ]
        )
    return BOM + out.getvalue()


def export_grade_exam(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_exam_id: UUID,
    *,
    request: Request | None = None,
) -> tuple[str, str]:
    """Return (file stem, csv text) and record ``score.export`` in the same transaction."""
    report, rows = _students(
        db, user, bindings, grade_exam_id, None, action=EXPORT_ACTION, request=request
    )
    text = export_csv(rows, report.subjects)
    record(
        db,
        user_id=user.id,
        action=EXPORT_ACTION,
        success=True,
        object_type="grade_exam",
        object_id=str(report.ge.id),
        request=request,
        extra={"rows": len(rows)},
    )
    db.commit()
    return f"{report.ge.name}-成绩汇总", text
