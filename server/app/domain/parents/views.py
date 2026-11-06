"""家长端读接口与改联系人的服务层。

每个函数的第一步都是 `child_link_or_deny`(没有有效绑定一律 403 + 审计);取数尽量复用教师端
已有的服务函数。迷你教室只返回坐标,响应里不出现其他学生的任何身份。
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.ai.stats import exam_table, round1
from app.audit.service import record
from app.domain.attendance.service import day_view
from app.domain.exams.schemas import ExamType, SubjectFull
from app.domain.growth.service import list_records
from app.domain.org.service import _brief_rows
from app.domain.parents.access import (
    READONLY_DAYS,
    child_link_or_deny,
    effective_status,
    my_links,
    parent_bindings,
)
from app.domain.reviews.service import _decode_cursor, _encode_cursor
from app.domain.school_settings.service import get_switches
from app.domain.schools.service import (
    active_academic_year,
    local_day_start_utc,
    school_tz,
    week_monday,
)
from app.domain.students.schemas import Contact, StudentProfile
from app.domain.students.service import build_profile
from app.errors import ApiError
from app.models import (
    AcademicYear,
    Comment,
    Enrollment,
    Exam,
    Grade,
    Review,
    SchoolClass,
    Score,
    Student,
    User,
)
from app.models.parents import ParentLink
from app.rbac.bindings import Scope

REVIEW_PAGE = 30
TODAY_WINDOW_DAYS = 30

Row = tuple[Enrollment, SchoolClass, Grade, AcademicYear]


# ---- 响应模型 ----


class ParentChild(BaseModel):
    student_id: UUID
    name: str
    gender: str | None
    class_name: str | None
    grade_name: str | None
    relation: str
    is_primary: bool
    status: Literal["active", "readonly"]
    left_on: date | None
    archive_on: date | None
    # 只读时的原因(L77):最后一条注册是毕业 → graduated;移出 / 转出 → left;在读为 null
    left_reason: Literal["graduated", "left"] | None


class Seat(BaseModel):
    row: int
    col: int


class MiniSeatMap(BaseModel):
    rows: int
    cols: int
    desk_size: Literal[1, 2, 3]
    podium_left: int
    podium_right: int
    occupied: list[Seat]
    mine: Seat | None


class ParentReview(BaseModel):
    id: UUID
    reason_text: str
    score_delta: int
    subject: str | None
    given_at: datetime
    given_by_name: str | None


class ParentAttendance(BaseModel):
    status: Literal["present", "leave", "absent", "late"]
    reason: str | None


class TeacherOfClass(BaseModel):
    subject: str
    name: str


class ClassInfo(BaseModel):
    class_name: str
    homeroom_name: str | None
    teachers: list[TeacherOfClass]


class ParentToday(BaseModel):
    date: date
    status: Literal["active", "readonly"]
    attendance: ParentAttendance | None
    attendance_confirmed: bool
    reviews: list[ParentReview]
    week_points: int
    class_info: ClassInfo | None
    enrollment_id: UUID | None
    seat_map: MiniSeatMap | None


class ParentProfile(BaseModel):
    id: UUID
    enrollment_id: UUID
    mk: str
    name: str
    class_id: UUID
    gender: str | None = None
    student_no: str | None = None
    birthdate: date | None = None
    avatar_seed: str | None = None
    class_role: str | None = None
    family_structure: str | None = None
    learning_summary: str | None = None
    personality: str | None = None
    health_notes: str | None = None
    tags: list[str] | None = None
    boarding: bool | None = None
    family_note: str | None = None
    contacts: list[Contact] | None = None
    can_edit_contacts: bool


class ContactsInput(BaseModel):
    contacts: Annotated[list[Contact], Field(max_length=2)]


class ParentGrowthRecord(BaseModel):
    id: UUID
    type: str
    date: date
    content: str
    year_name: str
    created_by_name: str | None


class ParentComment(BaseModel):
    id: UUID
    semester: str
    content: str
    created_at: datetime


class ParentReviewPage(BaseModel):
    items: list[ParentReview]
    next_cursor: str | None


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


# ---- 取数小工具 ----


def _enrollment_rows(db: Session, student_ids: Sequence[UUID]) -> dict[UUID, list[Row]]:
    """这些学生自己的全部注册(含已移出的 removed),每人按学年、入班时间从新到旧;一次查完。"""
    out: dict[UUID, list[Row]] = defaultdict(list)
    if not student_ids:
        return out
    rows = db.execute(
        select(Enrollment, SchoolClass, Grade, AcademicYear)
        .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
        .join(Grade, Grade.id == SchoolClass.grade_id)
        .join(AcademicYear, AcademicYear.id == Enrollment.academic_year_id)
        .where(Enrollment.student_id.in_(student_ids))
        .order_by(AcademicYear.start_date.desc(), Enrollment.entered_at.desc(), Enrollment.id)
    ).all()
    for e, c, g, y in rows:
        out[e.student_id].append((e, c, g, y))
    return out


def _shown(rows: Sequence[Row]) -> Row | None:
    """在读的那条;没有在读就取最后一条。"""
    return next((r for r in rows if r[0].status == "active"), rows[0] if rows else None)


def _status(link: ParentLink, now: datetime) -> Literal["active", "readonly"]:
    status = effective_status(link, now)
    assert status is not None  # child_link_or_deny / my_links 已保证
    return status


def _left_reason(
    status: Literal["active", "readonly"], shown: Row | None
) -> Literal["graduated", "left"] | None:
    """只读的原因(L77):看最后一条注册——毕业是 graduated,其余(移出 / 转出)都是离校。"""
    if status != "readonly":
        return None
    return "graduated" if shown is not None and shown[0].status == "graduated" else "left"


def _student(db: Session, student_id: UUID) -> Student:
    student = db.get(Student, student_id)
    if student is None:  # 绑定存在而学生不存在:外键保证不会发生
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    return student


def _review_out(r: Review, author: str | None) -> ParentReview:
    return ParentReview(
        id=r.id,
        reason_text=r.reason_text,
        score_delta=r.score_delta,
        subject=r.subject,
        given_at=r.given_at,
        given_by_name=author,
    )


def _enrollment_ids(rows: Sequence[Row]) -> list[UUID]:
    return [r[0].id for r in rows]


# ---- 接口 ----


def children(db: Session, user: User, now: datetime) -> list[ParentChild]:
    links = my_links(db, user.id, now)
    if not links:
        return []
    ids = [lk.student_id for lk in links]
    students = {s.id: s for s in db.scalars(select(Student).where(Student.id.in_(ids)))}
    rows = _enrollment_rows(db, ids)
    tz = school_tz(db, user.school_id)
    out: list[ParentChild] = []
    for lk in links:
        status = _status(lk, now)
        shown = _shown(rows.get(lk.student_id, []))
        left_on = archive_on = None
        if status == "readonly" and lk.readonly_since is not None:
            left_on = lk.readonly_since.astimezone(tz).date()
            archive_on = (lk.readonly_since + timedelta(days=READONLY_DAYS)).astimezone(tz).date()
        student = students[lk.student_id]
        out.append(
            ParentChild(
                student_id=student.id,
                name=student.name,
                gender=student.gender,
                class_name=shown[1].name if shown else None,
                grade_name=shown[2].name if shown else None,
                relation=lk.relation or "其他",
                is_primary=lk.is_primary,
                status=status,
                left_on=left_on,
                archive_on=archive_on,
                left_reason=_left_reason(status, shown),
            )
        )
    out.sort(key=lambda c: (c.status != "active", c.name))
    return out


def _mini_map(db: Session, cls: SchoolClass, mine: Enrollment) -> MiniSeatMap:
    seats = db.execute(
        select(Enrollment.seat_row, Enrollment.seat_col)
        .where(
            Enrollment.class_id == cls.id,
            Enrollment.status == "active",
            Enrollment.seat_row.is_not(None),
            Enrollment.seat_col.is_not(None),
        )
        .order_by(Enrollment.seat_row, Enrollment.seat_col)
    ).all()
    has_seat = mine.seat_row is not None and mine.seat_col is not None
    return MiniSeatMap(
        rows=cls.seat_rows,
        cols=cls.seat_cols,
        desk_size=cls.desk_size,  # type: ignore[arg-type]
        podium_left=cls.podium_left,
        podium_right=cls.podium_right,
        occupied=[Seat(row=r, col=c) for r, c in seats],
        mine=Seat(row=mine.seat_row, col=mine.seat_col) if has_seat else None,  # type: ignore[arg-type]
    )


def _class_info(db: Session, cls: SchoolClass) -> ClassInfo:
    homeroom: str | None = None
    teachers: list[TeacherOfClass] = []
    for r in _brief_rows(db, [cls.id]):
        if r.identity == "homeroom":
            homeroom = r.display_name
        if r.subject:
            teachers.append(TeacherOfClass(subject=r.subject, name=r.display_name))
    return ClassInfo(class_name=cls.name, homeroom_name=homeroom, teachers=teachers)


def today(
    db: Session,
    request: Request | None,
    user: User,
    student_id: UUID,
    day: date | None,
    now: datetime,
) -> ParentToday:
    link = child_link_or_deny(db, request, user, student_id, now=now)
    status = _status(link, now)
    tz = school_tz(db, user.school_id)
    school_today = now.astimezone(tz).date()
    day = day or school_today
    if day > school_today or day < school_today - timedelta(days=TODAY_WINDOW_DAYS):
        raise ApiError(400, "DATE_OUT_OF_RANGE", "只能查看今天起 30 天内的记录")
    switches = get_switches(db, user.school_id)

    rows = _enrollment_rows(db, [student_id])[student_id]
    shown = _shown(rows)
    current = shown if status == "active" and shown and shown[0].status == "active" else None

    attendance: ParentAttendance | None = None
    confirmed = False
    if shown is not None and status == "active":
        view = day_view(db, shown[1].id, day)
        confirmed = view.confirmed_at is not None
        rec = next((i for i in view.items if i.enrollment_id == shown[0].id), None)
        if rec is not None:
            attendance = ParentAttendance(status=rec.status, reason=rec.reason)  # type: ignore[arg-type]
        elif confirmed:
            attendance = ParentAttendance(status="present", reason=None)

    enrollment_ids = _enrollment_ids(rows)
    visible = [] if not enrollment_ids else _review_filter(enrollment_ids, switches)
    day_start = local_day_start_utc(day, tz)
    reviews = _query_reviews(
        db,
        visible,
        Review.given_at >= day_start,
        Review.given_at < local_day_start_utc(day + timedelta(days=1), tz),
    )
    week_start = local_day_start_utc(week_monday(school_today), tz)
    week_points = 0
    if enrollment_ids:
        total = db.scalar(
            select(func.coalesce(func.sum(Review.score_delta), 0)).where(
                *_review_filter(enrollment_ids, switches),
                Review.given_at >= week_start,
            )
        )
        week_points = int(total or 0)

    return ParentToday(
        date=day,
        status=status,
        attendance=attendance,
        attendance_confirmed=confirmed,
        reviews=[_review_out(r, a) for r, a in reviews],
        week_points=week_points,
        class_info=_class_info(db, shown[1]) if shown else None,
        enrollment_id=current[0].id if current else None,
        seat_map=_mini_map(db, current[1], current[0]) if current else None,
    )


def _review_filter(enrollment_ids: Sequence[UUID], switches: Any) -> list[Any]:
    conds: list[Any] = [Review.enrollment_id.in_(enrollment_ids), Review.revoked_at.is_(None)]
    if not switches.parent_negative_review:
        conds.append(Review.score_delta > 0)
    return conds


def _query_reviews(
    db: Session, conds: Sequence[Any], *extra: Any, limit: int | None = None
) -> list[tuple[Review, str | None]]:
    if not conds:
        return []
    stmt = (
        select(Review, User.display_name)
        .join(Enrollment, Enrollment.id == Review.enrollment_id)
        .outerjoin(User, User.id == Review.given_by_user_id)
        .where(*conds, *extra)
        .order_by(Review.given_at.desc(), Review.id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return [(r, a) for r, a in db.execute(stmt).all()]


def _scope_of(cls: SchoolClass, student_id: UUID) -> Scope:
    return Scope(
        school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id, student_id=student_id
    )


def _profile_of(
    db: Session, user: User, link: ParentLink, student_id: UUID, now: datetime
) -> ParentProfile:
    student = _student(db, student_id)
    shown = _shown(_enrollment_rows(db, [student_id])[student_id])
    if shown is None:
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    enrollment, cls, _, _ = shown
    profile: StudentProfile = build_profile(
        student, _scope_of(cls, student_id), enrollment, parent_bindings(link), user.id
    )
    data = profile.model_dump(exclude={"teacher_notes", "note"}, exclude_none=True)
    can_edit = link.is_primary and effective_status(link, now) == "active"
    return ParentProfile(**data, can_edit_contacts=can_edit)


def profile(
    db: Session, request: Request | None, user: User, student_id: UUID, now: datetime
) -> ParentProfile:
    link = child_link_or_deny(db, request, user, student_id, now=now)
    return _profile_of(db, user, link, student_id, now)


def save_contacts(
    db: Session,
    request: Request | None,
    user: User,
    student_id: UUID,
    raw: dict[str, Any],
    now: datetime,
) -> ParentProfile:
    # 先判权再校验请求体:非家长带非法体也是 403,不泄露字段规则(L78)
    link = child_link_or_deny(db, request, user, student_id, now=now, write=True)
    try:
        body = ContactsInput.model_validate(raw)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from None
    student = db.scalar(
        select(Student)
        .where(Student.id == student_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert student is not None  # child_link_or_deny 已保证绑定存在
    # 等锁期间班主任可能已解绑/降级并提交:丢弃会话缓存的旧绑定,加锁后重新读库再判权(L78)
    db.expire_all()
    link = child_link_or_deny(db, request, user, student_id, now=now, write=True)
    student.contacts = [c.model_dump() for c in body.contacts]
    record(
        db,
        user_id=user.id,
        action="student.parent_update",
        success=True,
        object_type="student",
        object_id=str(student_id),
        request=request,
    )
    db.commit()
    return _profile_of(db, user, link, student_id, now)


def growth_records(
    db: Session, request: Request | None, user: User, student_id: UUID, now: datetime
) -> list[ParentGrowthRecord]:
    link = child_link_or_deny(db, request, user, student_id, now=now)
    year = active_academic_year(db, user.school_id)
    # 只借用 list_records 的取数(姓名、学年、日期倒序);can_delete 等教师字段不下发
    items = list_records(
        db, student_id, year.id if year else UUID(int=0), user.id, parent_bindings(link)
    )
    return [
        ParentGrowthRecord(
            id=i.id,
            type=i.type,
            date=i.date,
            content=i.content,
            year_name=i.academic_year_name,
            created_by_name=i.created_by_name,
        )
        for i in items
    ]


def comments(
    db: Session, request: Request | None, user: User, student_id: UUID, now: datetime
) -> list[ParentComment]:
    child_link_or_deny(db, request, user, student_id, now=now)
    rows = db.scalars(
        select(Comment)
        .join(AcademicYear, AcademicYear.id == Comment.academic_year_id)
        .where(Comment.student_id == student_id, Comment.parent_visible.is_(True))
        .order_by(
            AcademicYear.start_date.desc(),
            Comment.semester.desc(),
            Comment.created_at.desc(),
            Comment.id,
        )
    ).all()
    return [
        ParentComment(id=c.id, semester=c.semester, content=c.content, created_at=c.created_at)
        for c in rows
    ]


def reviews(
    db: Session,
    request: Request | None,
    user: User,
    student_id: UUID,
    cursor: str | None,
    now: datetime,
) -> ParentReviewPage:
    child_link_or_deny(db, request, user, student_id, now=now)
    switches = get_switches(db, user.school_id)
    ids = _enrollment_ids(_enrollment_rows(db, [student_id])[student_id])
    extra: list[Any] = []
    if cursor:
        at, rid = _decode_cursor(cursor)
        if at.tzinfo is None:
            raise ApiError(400, "BAD_REQUEST", "分页游标无效")
        extra.append(tuple_(Review.given_at, Review.id) < (at, rid))
    rows = _query_reviews(
        db, _review_filter(ids, switches) if ids else [], *extra, limit=REVIEW_PAGE + 1
    )
    page = rows[:REVIEW_PAGE]
    next_cursor = _encode_cursor(page[-1][0]) if len(rows) > REVIEW_PAGE else None
    return ParentReviewPage(items=[_review_out(r, a) for r, a in page], next_cursor=next_cursor)


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
    enroll = _enrollment_rows(db, [student_id])[student_id]
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


def _exam_roster(db: Session, school_id: UUID, exam: Exam) -> list[UUID]:
    """这场考试参与名次 / 平均 / 最高的注册,与教师端同一口径(L76):当前学年的班只算在读注册
    (score_sheet / gradebook 的 active_enrollments),往年的班算全部未删除的注册
    (history.exam_scores)。被移出 / 转出的注册都不算;按 Student.mk 排序让同分并列顺序确定。"""
    year = active_academic_year(db, school_id)
    current = year is not None and exam.academic_year_id == year.id
    enrolled = Enrollment.status == "active" if current else Enrollment.status != "removed"
    return list(
        db.scalars(
            select(Enrollment.id)
            .join(Student, Student.id == Enrollment.student_id)
            .where(Enrollment.class_id == exam.class_id, enrolled)
            .order_by(Student.mk)
        )
    )


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
    enroll = _enrollment_rows(db, [student_id])[student_id]
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

    ids = _exam_roster(db, user.school_id, exam)
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
