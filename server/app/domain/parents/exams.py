"""家长端的考试列表与单场详情(L278,从 views.py 搬出)。

名次 / 平均 / 最高用的名单与教师端同一口径(students/service.py::exam_roster_ids,L76):
当前学年的班只算在读注册,往年的班算全部未删除的注册;孩子已不在名单里时自己的分数照给、没有名次。
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.stats import exam_table, round1
from app.audit.service import record
from app.domain.exams.schemas import ExamType, SubjectFull
from app.domain.parents.access import child_link_or_deny
from app.domain.parents.views import Row, enrollment_rows
from app.domain.school_settings.service import get_switches
from app.domain.schools.service import active_academic_year, school_tz
from app.domain.students.service import exam_roster_ids
from app.errors import ApiError
from app.models import AcademicYear, Enrollment, Exam, SchoolClass, Score, User


class ParentExamItem(BaseModel):
    id: UUID
    name: str
    exam_type: ExamType
    date: date
    year_name: str
    class_name: str


class ExamSubjectScore(BaseModel):
    name: str
    full: int
    score: float | None
    class_avg: float | None
    class_max: float | None


class ParentExamDetail(BaseModel):
    exam: ParentExamItem
    subjects: list[ExamSubjectScore]
    total: float | None
    total_full: int
    ranked: int
    class_rank: int | None
    band: Literal["前 10%", "前 30%"] | None


def _exam_item(exam: Exam, year_name: str, class_name: str) -> ParentExamItem:
    return ParentExamItem(
        id=exam.id,
        name=exam.name,
        exam_type=exam.exam_type,  # type: ignore[arg-type]
        date=exam.date,
        year_name=year_name,
        class_name=class_name,
    )


def _class_cutoffs(db: Session, school_id: UUID, rows: Sequence[Row]) -> dict[UUID, date | None]:
    """每个班里孩子可看考试的截止日(学校本地日期):该班没有在读注册、且有结束日时,
    取最晚的 left_at;在读或没有结束日(如毕业)不截止。"""
    tz = school_tz(db, school_id)
    by_class: dict[UUID, list[Enrollment]] = defaultdict(list)
    for e, c, _, _ in rows:
        by_class[c.id].append(e)
    out: dict[UUID, date | None] = {}
    for cid, ens in by_class.items():
        ends = [e.left_at for e in ens]
        if any(e.status == "active" for e in ens) or any(x is None for x in ends):
            out[cid] = None
        else:
            out[cid] = max(x for x in ends if x is not None).astimezone(tz).date()
    return out


def exams(
    db: Session, request: Request | None, user: User, student_id: UUID, now: datetime
) -> list[ParentExamItem]:
    child_link_or_deny(db, request, user, student_id, now=now)
    enroll = enrollment_rows(db, [student_id])[student_id]
    cutoffs = _class_cutoffs(db, user.school_id, enroll)
    class_ids = {r[1].id for r in enroll}
    if not class_ids:
        return []
    rows = db.execute(
        select(Exam, AcademicYear.name, SchoolClass.name)
        .join(AcademicYear, AcademicYear.id == Exam.academic_year_id)
        .join(SchoolClass, SchoolClass.id == Exam.class_id)
        .where(Exam.class_id.in_(class_ids))
        .order_by(Exam.date.desc(), Exam.created_at.desc(), Exam.id)
    ).all()
    return [
        _exam_item(e, y, c)
        for e, y, c in rows
        if cutoffs.get(e.class_id) is None or e.date <= cutoffs[e.class_id]
    ]


def _band(rank: int | None, ranked: int) -> Literal["前 10%", "前 30%"] | None:
    if rank is None or ranked < 10:
        return None
    if rank <= -(-ranked * 10 // 100):
        return "前 10%"
    if rank <= -(-ranked * 30 // 100):
        return "前 30%"
    return None


def exam_detail(
    db: Session,
    request: Request | None,
    user: User,
    student_id: UUID,
    exam_id: UUID,
    now: datetime,
) -> ParentExamDetail:
    child_link_or_deny(db, request, user, student_id, now=now)
    switches = get_switches(db, user.school_id)
    enroll = enrollment_rows(db, [student_id])[student_id]
    mine = {r[1].id: r[0] for r in reversed(enroll)}
    cutoffs = _class_cutoffs(db, user.school_id, enroll)
    exam = db.get(Exam, exam_id)
    if (
        exam is None
        or exam.class_id not in mine
        or (cutoffs[exam.class_id] is not None and exam.date > cutoffs[exam.class_id])
    ):
        record(
            db,
            user_id=user.id,
            action="parent.view",
            success=False,
            object_type="student",
            object_id=str(student_id),
            request=request,
            extra={"exam_id": str(exam_id)},
        )
        db.commit()
        raise ApiError(403, "FORBIDDEN", "没有权限访问该资源")
    my_enrollment = mine[exam.class_id].id
    year_name = db.scalars(
        select(AcademicYear.name).where(AcademicYear.id == exam.academic_year_id)
    ).one()
    class_name = db.scalars(select(SchoolClass.name).where(SchoolClass.id == exam.class_id)).one()

    year = active_academic_year(db, user.school_id)
    ids = exam_roster_ids(
        db, exam, current_year=year is not None and exam.academic_year_id == year.id
    )
    scores: dict[UUID, dict[str, float | None]] = {}
    for eid, subject, value in db.execute(
        select(Score.enrollment_id, Score.subject, Score.value).where(Score.exam_id == exam.id)
    ):
        scores.setdefault(eid, {})[subject] = value
    subjects = [SubjectFull(**s) for s in exam.subjects]
    table = exam_table(subjects, scores, ids)
    # 孩子已不在名单里(被移出 / 转出):自己的分数照给,但不补进名单,也就没有名次与段位(L76)
    on_roster = my_enrollment in ids
    me = (
        next(r for r in table if r.enrollment_id == my_enrollment)
        if on_roster
        else exam_table(subjects, scores, [my_enrollment])[0]
    )
    ranked = sum(1 for r in table if r.total is not None)
    rank = me.rank if on_roster else None

    detail: list[ExamSubjectScore] = []
    for s in subjects:
        vals = [v for r in table if (v := r.subs.get(s.name)) is not None]
        detail.append(
            ExamSubjectScore(
                name=s.name,
                full=s.full,
                score=me.subs.get(s.name),
                class_avg=round1(sum(vals) / len(vals)) if vals else None,
                class_max=max(vals) if vals else None,
            )
        )
    return ParentExamDetail(
        exam=_exam_item(exam, year_name, class_name),
        subjects=detail,
        total=me.total,
        total_full=sum(s.full for s in subjects),
        ranked=ranked,
        class_rank=rank if switches.parent_rank else None,
        band=None if switches.parent_rank else _band(rank, ranked),
    )
