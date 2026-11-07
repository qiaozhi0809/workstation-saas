from collections import defaultdict
from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import case, column, func, select, table
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny
from app.domain.cameras.access import admin_sees_class, enabled_camera_counts
from app.domain.classes.service import class_scope_of
from app.domain.classes.sort import class_sort_key
from app.domain.exams.subjects import grade_stage
from app.domain.grade_exams.service import progress
from app.domain.notices.service import recent_sent
from app.domain.overview.schemas import (
    Absentee,
    BoardClass,
    BoardClassDetail,
    BoardMetrics,
    BoardView,
    BottomStudent,
    ClassWeek,
    DetailAbsentee,
    GradeBrief,
    GradeExamCard,
    MyNotice,
    TeacherCount,
    TodayView,
    Totals,
    Unconfirmed,
    WeekReviews,
)
from app.domain.school_settings.service import get_switches
from app.domain.schools.service import (
    local_day_start_utc,
    require_active_year,
    school_tz,
    week_monday,
)
from app.domain.students.schemas import StudentSeat
from app.models import (
    AcademicYear,
    Attendance,
    AttendanceDay,
    Enrollment,
    Grade,
    GradeExam,
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


def _leader_bindings(bindings: Sequence[Binding]) -> list[Binding]:
    """看全校只认领导身份;兼任别班班主任等教师身份不扩大可见范围。"""
    return [b for b in bindings if b.role in LEADER_ROLES]


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
    ).all()
    # 年级按 display_order,同年级班名按数值排(L40)
    rows.sort(key=lambda r: (r[1].display_order, class_sort_key(r[0].name), str(r[0].id)))
    return [
        VisibleClass(cls, grade, name)
        for cls, grade, name in rows
        if can(_leader_bindings(bindings), Perm.CLASS_READ, class_scope_of(cls))
    ]


def _visible_grades(
    db: Session, bindings: Sequence[Binding], year_id: UUID, visible: list[VisibleClass]
) -> list[Grade]:
    """可见班所在的年级,加上领导绑定的年级(即使该年级当前没有在读班)。"""
    found = {v.grade.id: v.grade for v in visible}
    bound = {
        b.scope.grade_id
        for b in _leader_bindings(bindings)
        if b.scope.grade_id is not None and b.scope.grade_id not in found
    }
    if bound:
        for g in db.scalars(
            select(Grade).where(Grade.id.in_(bound), Grade.academic_year_id == year_id)
        ):
            found[g.id] = g
    return sorted(found.values(), key=lambda g: (g.display_order, g.name))


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


MY_NOTICES = 3


def _my_notices(db: Session, user: User) -> list[MyNotice]:
    return [
        MyNotice(
            id=n.id, title=n.title, created_at=n.created_at, recipients=n.recipients, read=n.read
        )
        for n in recent_sent(db, user, MY_NOTICES)
    ]


def _grade_exam_card(
    db: Session, year_id: UUID, visible: list[VisibleClass], grades: list[Grade]
) -> GradeExamCard | None:
    """调用者可见年级内当前学年日期最近的一场联考(日期降序、再按创建时间降序)。

    进度口径与联考管理页同一份(grade_exams.service.progress),只对调用者可见的班求和。"""
    grade_ids = [g.id for g in grades]
    if not grade_ids:
        return None
    ge = db.scalars(
        select(GradeExam)
        .where(GradeExam.academic_year_id == year_id, GradeExam.grade_id.in_(grade_ids))
        .order_by(GradeExam.date.desc(), GradeExam.created_at.desc(), GradeExam.id)
        .limit(1)
    ).first()
    if ge is None:
        return None
    visible_ids = {v.cls.id for v in visible}
    rows = [r for r in progress(db, ge) if r.class_id in visible_ids]
    entered = sum(r.entered for r in rows)
    expected = sum(r.expected for r in rows)
    grade_name = next(g.name for g in grades if g.id == ge.grade_id)
    return GradeExamCard(
        id=ge.id, name=ge.name, grade_name=grade_name, entered=entered, expected=expected
    )


def today_view(db: Session, user: User, bindings: Sequence[Binding]) -> TodayView:
    year = require_active_year(db, user.school_id)
    visible = _visible(db, bindings, year.id, year.school_id)
    today, week_start = _today_and_start(db, year.school_id)
    ids = [v.cls.id for v in visible]
    names = {v.cls.id: v.cls.name for v in visible}
    order = {cid: i for i, cid in enumerate(ids)}

    if can(_leader_bindings(bindings), Perm.CLASS_READ, Scope(school_id=year.school_id)):
        scope_label = "全校"
    else:
        grades = _visible_grades(db, bindings, year.id, visible)
        scope_label = "、".join(g.name for g in grades)

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
            grade_exam=None,
            my_notices=_my_notices(db, user),
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
        grade_exam=_grade_exam_card(
            db, year.id, visible, _visible_grades(db, bindings, year.id, visible)
        ),
        my_notices=_my_notices(db, user),
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


def _camera_counts(
    db: Session, bindings: Sequence[Binding], picked: list[VisibleClass], school_id: UUID
) -> dict[UUID, int]:
    """每班启用的摄像头数:仅 camera.view / camera.manage 覆盖该班的人;监控开关关 = 0。"""
    if not get_switches(db, school_id).monitor:
        return {}
    allowed = [v.cls.id for v in picked if admin_sees_class(bindings, v.cls)]
    return enabled_camera_counts(db, allowed)


def _build_board_classes(
    db: Session, picked: list[VisibleClass], year: AcademicYear, bindings: Sequence[Binding]
) -> list[BoardClass]:
    ids = [v.cls.id for v in picked]
    cameras = _camera_counts(db, bindings, picked, year.school_id)
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
                cameras=cameras.get(cid, 0),
            )
        )
    return classes


def board_view(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    grade_id: UUID | None,
    request: Request | None = None,
) -> BoardView:
    year = require_active_year(db, user.school_id)
    visible = _visible(db, bindings, year.id, year.school_id)
    grades = [
        (g.id, g.name, grade_stage(g)) for g in _visible_grades(db, bindings, year.id, visible)
    ]
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
    grade_list = [
        GradeBrief(id=gid, name=name, effective_stage=stage) for gid, name, stage in grades
    ]
    if not picked:
        return BoardView(grades=grade_list, grade_id=grade_id, classes=[])

    return BoardView(
        grades=grade_list,
        grade_id=grade_id,
        classes=_build_board_classes(db, picked, year, bindings),
    )


def board_class_detail(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    request: Request | None = None,
) -> BoardClassDetail:
    year = require_active_year(db, user.school_id)
    picked = [v for v in _visible(db, bindings, year.id, year.school_id) if v.cls.id == class_id]
    if not picked:
        deny(
            db,
            user_id=user.id,
            action=SCHOOL_VIEW,
            object_type="class",
            object_id=str(class_id),
            request=request,
        )
    [card] = _build_board_classes(db, picked, year, bindings)
    today, _ = _today_and_start(db, year.school_id)
    rows = db.execute(
        select(Student.id, Student.name, Attendance.status, Attendance.reason)
        .join(Enrollment, Enrollment.id == Attendance.enrollment_id)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Attendance.class_id == class_id,
            Attendance.date == today,
            Attendance.status.in_(["leave", "absent"]),
            Enrollment.status == "active",
        )
        .order_by(Student.mk)
    ).all()
    return BoardClassDetail(
        **card.model_dump(),
        absentees=[
            DetailAbsentee(student_id=sid, name=name, status=st, reason=reason)
            for sid, name, st, reason in rows
        ],
    )
