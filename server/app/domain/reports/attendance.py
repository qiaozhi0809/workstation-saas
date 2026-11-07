import csv
import io
import re
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import Date, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny
from app.domain.classes.service import class_scope_of
from app.domain.overview.service import SCHOOL_VIEW, visible_classes
from app.domain.schools.service import require_active_year, school_tz
from app.errors import ApiError
from app.models import Attendance, AttendanceDay, Enrollment, Grade, Student, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import LEADER_ROLES, Perm

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
MIN_YEAR, MAX_YEAR = 1970, 2100  # 与 ai_admin 一致;范围外的月份 date() 会溢出
STATUSES = ("leave", "absent", "late")


class AttendanceCounts(BaseModel):
    days: int
    expected: int
    present: int
    leave: int
    absent: int
    late: int
    rate: float | None


class AttendanceClassRow(AttendanceCounts):
    class_id: UUID
    class_name: str
    grade_name: str


class AttendanceReport(BaseModel):
    month: str
    scope_label: str
    classes: list[AttendanceClassRow]
    total: AttendanceCounts


class StudentAttendance(BaseModel):
    student_id: UUID
    name: str
    student_no: str | None
    leave: int
    absent: int
    late: int


class AttendanceClassDetail(BaseModel):
    month: str
    class_id: UUID
    class_name: str
    days: int
    students: list[StudentAttendance]


def resolve_month(db: Session, school_id: UUID, month: str | None) -> str:
    """缺省为学校时区的本月;格式必须是 YYYY-MM。"""
    if month is None:
        today = clock.utc_now().astimezone(school_tz(db, school_id)).date()
        return f"{today.year:04d}-{today.month:02d}"
    if not re.fullmatch(MONTH_PATTERN, month) or not MIN_YEAR <= int(month[:4]) <= MAX_YEAR:
        raise ApiError(400, "BAD_REQUEST", "月份格式应为 YYYY-MM")
    return month


def _bounds(month: str) -> tuple[date, date]:
    year, mon = int(month[:4]), int(month[5:])
    return date(year, mon, 1), date(year + (mon == 12), mon % 12 + 1, 1)


def _local_date(column, tzname: str):
    return cast(func.timezone(tzname, column), Date)


def _on_roster(day, tzname: str):
    """该注册记录在 day(学校本地日期)在读:进班日 ≤ day,且未离班或离班日 > day。"""
    return and_(
        _local_date(Enrollment.entered_at, tzname) <= day,
        or_(Enrollment.left_at.is_(None), _local_date(Enrollment.left_at, tzname) > day),
    )


def _counts(days: int, expected: int, leave: int, absent: int, late: int) -> AttendanceCounts:
    present = expected - leave - absent
    return AttendanceCounts(
        days=days,
        expected=expected,
        present=present,
        leave=leave,
        absent=absent,
        late=late,
        rate=present / expected if expected else None,
    )


def _report_classes(db: Session, user: User, bindings: Sequence[Binding]):
    """调用者既能看(class.read)又有 attendance.read 的在读班。"""
    year = require_active_year(db, user.school_id)
    classes = [
        c
        for c in visible_classes(db, bindings, year)
        if can(bindings, Perm.ATTENDANCE_READ, class_scope_of(c))
    ]
    return year, classes


def _scope_label(db: Session, bindings: Sequence[Binding], year, classes) -> str:
    leader = [b for b in bindings if b.role in LEADER_ROLES]
    if can(leader, Perm.CLASS_READ, Scope(school_id=year.school_id)):
        return "全校"
    ids = {c.grade_id for c in classes} | {
        b.scope.grade_id for b in leader if b.scope.grade_id is not None
    }
    grades = db.scalars(
        select(Grade)
        .where(Grade.id.in_(ids), Grade.academic_year_id == year.id)
        .order_by(Grade.display_order, Grade.name)
    ).all()
    return "、".join(g.name for g in grades)


def _class_stats(
    db: Session, class_ids: list[UUID], month: str, tzname: str
) -> dict[UUID, AttendanceCounts]:
    first, nxt = _bounds(month)
    in_month = and_(AttendanceDay.date >= first, AttendanceDay.date < nxt)

    days = dict(
        db.execute(
            select(AttendanceDay.class_id, func.count())
            .where(AttendanceDay.class_id.in_(class_ids), in_month)
            .group_by(AttendanceDay.class_id)
        ).all()
    )
    # 应到人次:记录日 × 当天在读注册记录,一条 SQL
    expected = dict(
        db.execute(
            select(AttendanceDay.class_id, func.count())
            .select_from(AttendanceDay)
            .join(
                Enrollment,
                and_(
                    Enrollment.class_id == AttendanceDay.class_id,
                    _on_roster(AttendanceDay.date, tzname),
                ),
            )
            .where(AttendanceDay.class_id.in_(class_ids), in_month)
            .group_by(AttendanceDay.class_id)
        ).all()
    )
    # 请假 / 缺勤 / 迟到只计已确认的记录日、且当天在读的学生
    status_rows = db.execute(
        select(Attendance.class_id, Attendance.status, func.count())
        .select_from(Attendance)
        .join(
            AttendanceDay,
            and_(
                AttendanceDay.class_id == Attendance.class_id, AttendanceDay.date == Attendance.date
            ),
        )
        .join(
            Enrollment,
            and_(Enrollment.id == Attendance.enrollment_id, _on_roster(Attendance.date, tzname)),
        )
        .where(Attendance.class_id.in_(class_ids), in_month, Attendance.status.in_(STATUSES))
        .group_by(Attendance.class_id, Attendance.status)
    ).all()
    status: dict[UUID, dict[str, int]] = defaultdict(dict)
    for class_id, st, n in status_rows:
        status[class_id][st] = n

    return {
        cid: _counts(
            days.get(cid, 0),
            expected.get(cid, 0),
            status[cid].get("leave", 0),
            status[cid].get("absent", 0),
            status[cid].get("late", 0),
        )
        for cid in class_ids
    }


def month_report(
    db: Session,
    bindings: Sequence[Binding],
    month: str,
    grade_id: UUID | None,
    *,
    user: User,
) -> AttendanceReport:
    year, classes = _report_classes(db, user, bindings)
    label = _scope_label(db, bindings, year, classes)
    if grade_id is not None:
        classes = [c for c in classes if c.grade_id == grade_id]
    grade_names = dict(
        db.execute(
            select(Grade.id, Grade.name).where(Grade.id.in_({c.grade_id for c in classes}))
        ).all()
    )
    stats = _class_stats(db, [c.id for c in classes], month, str(school_tz(db, year.school_id)))
    rows = [
        AttendanceClassRow(
            class_id=c.id,
            class_name=c.name,
            grade_name=grade_names[c.grade_id],
            **stats[c.id].model_dump(),
        )
        for c in classes
    ]
    total = _counts(
        sum(r.days for r in rows),
        sum(r.expected for r in rows),
        sum(r.leave for r in rows),
        sum(r.absent for r in rows),
        sum(r.late for r in rows),
    )
    return AttendanceReport(month=month, scope_label=label, classes=rows, total=total)


def class_detail(
    db: Session,
    bindings: Sequence[Binding],
    month: str,
    class_id: UUID,
    *,
    user: User,
    request: Request | None = None,
) -> AttendanceClassDetail:
    year, classes = _report_classes(db, user, bindings)
    picked = [c for c in classes if c.id == class_id]
    if not picked:
        deny(
            db,
            user_id=user.id,
            action=SCHOOL_VIEW,
            object_type="class",
            object_id=str(class_id),
            request=request,
        )
    cls = picked[0]
    tzname = str(school_tz(db, year.school_id))
    first, nxt = _bounds(month)
    # 只要记录日天数,一条 count 即可(L59);_class_stats 的应到 / 状态两条查询这里用不上
    days = (
        db.scalar(
            select(func.count())
            .select_from(AttendanceDay)
            .where(
                AttendanceDay.class_id == cls.id,
                AttendanceDay.date >= first,
                AttendanceDay.date < nxt,
            )
        )
        or 0
    )

    # 该月在这个班注册过的学生(含已转出):进班日 < 下月 1 日,且未离班或离班日 ≥ 本月 1 日
    students = db.execute(
        select(Student.id, Student.name, Student.student_no)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(
            Enrollment.class_id == cls.id,
            _local_date(Enrollment.entered_at, tzname) < nxt,
            or_(Enrollment.left_at.is_(None), _local_date(Enrollment.left_at, tzname) >= first),
        )
        .group_by(Student.id, Student.name, Student.student_no)
    ).all()
    rows = db.execute(
        select(Enrollment.student_id, Attendance.status, func.count())
        .select_from(Attendance)
        .join(
            AttendanceDay,
            and_(
                AttendanceDay.class_id == Attendance.class_id, AttendanceDay.date == Attendance.date
            ),
        )
        .join(
            Enrollment,
            and_(Enrollment.id == Attendance.enrollment_id, _on_roster(Attendance.date, tzname)),
        )
        .where(
            Attendance.class_id == cls.id,
            Attendance.date >= first,
            Attendance.date < nxt,
            Attendance.status.in_(STATUSES),
        )
        .group_by(Enrollment.student_id, Attendance.status)
    ).all()
    counts: dict[UUID, dict[str, int]] = defaultdict(dict)
    for sid, st, n in rows:
        counts[sid][st] = n

    items = [
        StudentAttendance(
            student_id=sid,
            name=name,
            student_no=no,
            leave=counts[sid].get("leave", 0),
            absent=counts[sid].get("absent", 0),
            late=counts[sid].get("late", 0),
        )
        for sid, name, no in students
    ]
    items.sort(
        key=lambda s: (
            -s.absent,
            -s.leave,
            -s.late,
            s.student_no is None,
            s.student_no or "",
            s.name,
        )
    )
    return AttendanceClassDetail(
        month=month, class_id=cls.id, class_name=cls.name, days=days, students=items
    )


CSV_HEADER = ["年级", "班级", "记录天数", "应到人次", "实到人次", "请假", "缺勤", "迟到", "出勤率"]


def _rate_text(rate: float | None) -> str:
    return "" if rate is None else f"{rate * 100:.1f}%"


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe_cell(text: str) -> str:
    """文本单元格以公式字符开头时加 ' 前缀,防止 Excel 当作公式执行(数字 / 百分比格不经此函数)。"""
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def _csv_row(grade: str, name: str, c: AttendanceCounts) -> list[str | int]:
    return [
        _safe_cell(grade),
        _safe_cell(name),
        c.days,
        c.expected,
        c.present,
        c.leave,
        c.absent,
        c.late,
        _rate_text(c.rate),
    ]


def export_csv(report: AttendanceReport) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for row in report.classes:
        writer.writerow(_csv_row(row.grade_name, row.class_name, row))
    writer.writerow(_csv_row("合计", "", report.total))
    return buf.getvalue()
