from collections import defaultdict
from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import case, column, func, select, table
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny
from app.domain.classes.service import class_scope_of
from app.domain.overview.schemas import (
    Absentee,
    BoardClass,
    BoardMetrics,
    BoardView,
    BottomStudent,
    ClassWeek,
    GradeBrief,
    TeacherCount,
    TodayView,
    Totals,
    Unconfirmed,
    WeekReviews,
)
from app.domain.schools.service import (
    local_day_start_utc,
    require_active_year,
    school_tz,
    week_monday,
)
from app.domain.students.schemas import StudentSeat
from app.models import (
    Attendance,
    AttendanceDay,
    Enrollment,
    Grade,
    Review,
    SchoolClass,
    Student,
    User,
)
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import LEADER_ROLES, Perm

SCHOOL_VIEW = "school.view"
BOTTOM_LIMIT = 5

_teachers = table("teachers", column("id"), column("user_id"))


class VisibleClass:
    def __init__(self, cls: SchoolClass, grade: Grade, homeroom_name: str | None) -> None:
        self.cls = cls
        self.grade = grade
        self.homeroom_name = homeroom_name


def ensure_school_view(
    db: Session, request: Request | None, user: User, bindings: Sequence[Binding]
) -> None:
    """school.view = 持有任一领导身份(校长 / 教导主任 / 年级组长);信息中心没有。"""
    if not any(bd.role in LEADER_ROLES for bd in bindings):
        deny(
            db,
            user_id=user.id,
            action=SCHOOL_VIEW,
            object_type="school",
            object_id=str(user.school_id),
            request=request,
        )


def _visible(
    db: Session, bindings: Sequence[Binding], year_id: UUID, school_id: UUID
) -> list[VisibleClass]:
    rows = db.execute(
        select(SchoolClass, Grade, User.display_name)
        .join(Grade, Grade.id == SchoolClass.grade_id)
        .outerjoin(_teachers, _teachers.c.id == SchoolClass.homeroom_teacher_id)
        .outerjoin(User, User.id == _teachers.c.user_id)
        .where(
            SchoolClass.school_id == school_id,
            SchoolClass.academic_year_id == year_id,
            SchoolClass.active.is_(True),
        )
        .order_by(Grade.display_order, SchoolClass.name)
    ).all()
    return [
        VisibleClass(cls, grade, name)
        for cls, grade, name in rows
        if can(bindings, Perm.CLASS_READ, class_scope_of(cls))
    ]


def visible_classes(db: Session, bindings: Sequence[Binding], year) -> list[SchoolClass]:
    """当前学年在读班中调用者能 class.read 的,按年级顺序、班名。"""
    return [v.cls for v in _visible(db, bindings, year.id, year.school_id)]


def _status_counts(db: Session, class_ids: list[UUID], day) -> dict[UUID, dict[str, int]]:
    rows = db.execute(
        select(Attendance.class_id, Attendance.status, func.count())
        .join(Enrollment, Enrollment.id == Attendance.enrollment_id)
        .where(
            Attendance.class_id.in_(class_ids),
            Attendance.date == day,
            Enrollment.status == "active",
        )
        .group_by(Attendance.class_id, Attendance.status)
    ).all()
    out: dict[UUID, dict[str, int]] = defaultdict(dict)
    for class_id, status, n in rows:
        out[class_id][status] = n
    return out


def _student_counts(db: Session, class_ids: list[UUID]) -> dict[UUID, int]:
    rows = db.execute(
        select(Enrollment.class_id, func.count())
        .where(Enrollment.class_id.in_(class_ids), Enrollment.status == "active")
        .group_by(Enrollment.class_id)
    ).all()
    return dict(rows)


def _confirmed(db: Session, class_ids: list[UUID], day) -> set[UUID]:
    return set(
        db.scalars(
            select(AttendanceDay.class_id).where(
                AttendanceDay.class_id.in_(class_ids), AttendanceDay.date == day
            )
        )
    )


def _week_start(db: Session, school_id: UUID, today):
    return local_day_start_utc(week_monday(today), school_tz(db, school_id))


def _class_week(db: Session, class_ids: list[UUID], week_start) -> dict[UUID, tuple[int, int]]:
    rows = db.execute(
        select(
            Review.class_id,
            func.coalesce(func.sum(case((Review.score_delta > 0, Review.score_delta), else_=0)), 0),
            func.coalesce(
                func.sum(case((Review.score_delta < 0, -Review.score_delta), else_=0)), 0
            ),
        )
        .where(
            Review.class_id.in_(class_ids),
            Review.revoked_at.is_(None),
            Review.given_at >= week_start,
        )
        .group_by(Review.class_id)
    ).all()
    return {class_id: (int(plus), int(minus)) for class_id, plus, minus in rows}


def _today_and_start(db: Session, school_id: UUID):
    tz = school_tz(db, school_id)
    today = clock.utc_now().astimezone(tz).date()
    return today, local_day_start_utc(week_monday(today), tz)


def today_view(db: Session, user: User, bindings: Sequence[Binding]) -> TodayView:
    year = require_active_year(db, user.school_id)
    visible = _visible(db, bindings, year.id, year.school_id)
    today, week_start = _today_and_start(db, year.school_id)
    ids = [v.cls.id for v in visible]
    names = {v.cls.id: v.cls.name for v in visible}
    order = {cid: i for i, cid in enumerate(ids)}

    if can(bindings, Perm.CLASS_READ, Scope(school_id=year.school_id)):
        scope_label = "全校"
    else:
        scope_label = "、".join(dict.fromkeys(v.grade.name for v in visible))

    if not ids:
        return TodayView(
            date=today.isoformat(),
            scope_label=scope_label,
            totals=Totals(
                students=0, present=0, leave=0, absent=0, late=0, classes=0, confirmed_classes=0
            ),
            absentees=[],
            unconfirmed=[],
            week_reviews=WeekReviews(classes=[], bottom=[], teachers=[]),
        )

    students = _student_counts(db, ids)
    status = _status_counts(db, ids, today)
    confirmed = _confirmed(db, ids, today)
    total = sum(students.values())
    leave = sum(s.get("leave", 0) for s in status.values())
    absent = sum(s.get("absent", 0) for s in status.values())
    late = sum(s.get("late", 0) for s in status.values())

    absentee_rows = db.execute(
        select(Attendance.class_id, Student.id, Student.name, Attendance.status, Attendance.reason)
        .join(Enrollment, Enrollment.id == Attendance.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Attendance.class_id.in_(ids),
            Attendance.date == today,
            Attendance.status.in_(["leave", "absent"]),
            Enrollment.status == "active",
        )
        .order_by(Student.mk)
    ).all()
    absentees = [
        Absentee(
            class_id=cid,
            class_name=names[cid],
            student_id=sid,
            name=name,
            status=st,
            reason=reason,
        )
        for cid, sid, name, st, reason in sorted(absentee_rows, key=lambda r: order[r[0]])
    ]

    week = _class_week(db, ids, week_start)
    classes = [
        ClassWeek(
            class_id=v.cls.id,
            class_name=v.cls.name,
            plus=week.get(v.cls.id, (0, 0))[0],
            minus=week.get(v.cls.id, (0, 0))[1],
            net=week.get(v.cls.id, (0, 0))[0] - week.get(v.cls.id, (0, 0))[1],
        )
        for v in visible
    ]
    classes.sort(key=lambda c: -c.net)  # 稳定排序,同分保持年级 / 班名顺序

    net = func.sum(Review.score_delta)
    bottom_rows = db.execute(
        select(Review.class_id, Student.id, Student.name, net)
        .join(Enrollment, Enrollment.id == Review.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Review.class_id.in_(ids),
            Review.revoked_at.is_(None),
            Review.given_at >= week_start,
            Enrollment.status == "active",
        )
        .group_by(Review.class_id, Student.id, Student.name)
        .having(net < 0)
        .order_by(net, Student.name)
        .limit(BOTTOM_LIMIT)
    ).all()
    bottom = [
        BottomStudent(class_id=cid, class_name=names[cid], student_id=sid, name=name, net=int(n))
        for cid, sid, name, n in bottom_rows
    ]

    count = func.count()
    teacher_rows = db.execute(
        select(User.id, User.display_name, count)
        .join(Review, Review.given_by_user_id == User.id)
        .where(
            Review.class_id.in_(ids),
            Review.revoked_at.is_(None),
            Review.given_at >= week_start,
        )
        .group_by(User.id, User.display_name)
        .order_by(count.desc(), User.display_name)
    ).all()
    teachers = [TeacherCount(user_id=uid, display_name=n, count=c) for uid, n, c in teacher_rows]

    return TodayView(
        date=today.isoformat(),
        scope_label=scope_label,
        totals=Totals(
            students=total,
            present=total - leave - absent,
            leave=leave,
            absent=absent,
            late=late,
            classes=len(ids),
            confirmed_classes=len(confirmed),
        ),
        absentees=absentees,
        unconfirmed=[
            Unconfirmed(class_id=v.cls.id, class_name=v.cls.name, homeroom_name=v.homeroom_name)
            for v in visible
            if v.cls.id not in confirmed
        ],
        week_reviews=WeekReviews(classes=classes, bottom=bottom, teachers=teachers),
    )


def _seats_by_class(db: Session, class_ids: list[UUID]) -> dict[UUID, list[StudentSeat]]:
    """一条 SQL 取全部班的名单;字段与排序同 list_roster。"""
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Enrollment.student_id == Student.id)
        .where(Enrollment.class_id.in_(class_ids), Enrollment.status == "active")
        .order_by(
            Enrollment.seat_row.asc().nulls_last(),
            Enrollment.seat_col.asc().nulls_last(),
            Student.mk,
        )
    ).all()
    out: dict[UUID, list[StudentSeat]] = defaultdict(list)
    for e, st in rows:
        out[e.class_id].append(
            StudentSeat(
                enrollment_id=e.id,
                student_id=st.id,
                name=st.name,
                mk=st.mk,
                seat_row=e.seat_row,
                seat_col=e.seat_col,
                avatar_seed=st.avatar_seed,
                gender=st.gender,
                student_no=st.student_no,
                birthdate=st.birthdate,
                class_role=e.class_role,
                seat_locked=e.seat_locked,
            )
        )
    return out


def board_view(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_id: UUID | None,
    request: Request | None = None,
) -> BoardView:
    year = require_active_year(db, user.school_id)
    visible = _visible(db, bindings, year.id, year.school_id)
    grades = list(dict.fromkeys((v.grade.id, v.grade.name) for v in visible))
    if grade_id is None:
        grade_id = grades[0][0] if grades else None
    elif grade_id not in {g[0] for g in grades}:
        deny(
            db,
            user_id=user.id,
            action=SCHOOL_VIEW,
            object_type="grade",
            object_id=str(grade_id),
            request=request,
        )
    picked = [v for v in visible if v.grade.id == grade_id]
    grade_list = [GradeBrief(id=gid, name=name) for gid, name in grades]
    if not picked:
        return BoardView(grades=grade_list, grade_id=grade_id, classes=[])

    ids = [v.cls.id for v in picked]
    today, week_start = _today_and_start(db, year.school_id)
    seats = _seats_by_class(db, ids)
    status = _status_counts(db, ids, today)
    confirmed = _confirmed(db, ids, today)
    week = _class_week(db, ids, week_start)

    att_rows = db.execute(
        select(Attendance.class_id, Attendance.enrollment_id, Attendance.status).where(
            Attendance.class_id.in_(ids), Attendance.date == today
        )
    ).all()
    attendance: dict[UUID, dict[str, str]] = defaultdict(dict)
    active = {st.enrollment_id for class_seats in seats.values() for st in class_seats}
    for cid, eid, st in att_rows:
        if eid in active:
            attendance[cid][str(eid)] = st

    classes = []
    for v in picked:
        cid = v.cls.id
        counts = status.get(cid, {})
        n = len(seats.get(cid, []))
        leave, absent = counts.get("leave", 0), counts.get("absent", 0)
        plus, minus = week.get(cid, (0, 0))
        classes.append(
            BoardClass(
                id=cid,
                name=v.cls.name,
                room=v.cls.room,
                homeroom_name=v.homeroom_name,
                seat_rows=v.cls.seat_rows,
                seat_cols=v.cls.seat_cols,
                desk_size=v.cls.desk_size,
                podium_left=v.cls.podium_left,
                podium_right=v.cls.podium_right,
                seats=seats.get(cid, []),
                attendance=attendance.get(cid, {}),
                metrics=BoardMetrics(
                    students=n,
                    present=n - leave - absent,
                    leave=leave,
                    absent=absent,
                    late=counts.get("late", 0),
                    confirmed=cid in confirmed,
                    week_net=plus - minus,
                ),
            )
        )
    return BoardView(grades=grade_list, grade_id=grade_id, classes=classes)
