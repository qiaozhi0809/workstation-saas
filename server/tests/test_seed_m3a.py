from datetime import date
from uuid import UUID

from sqlalchemy import func, select, text

from app.models import (
    Attendance,
    AttendanceDay,
    Enrollment,
    RoleBinding,
    SchoolClass,
    Student,
    User,
)
from tests.helpers import auth
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

NEW_ACCOUNTS = ["teacher04", "teacher05", "principal01", "dean01", "gradehead03", "itadmin01"]


def _user(db, login):
    return db.scalars(select(User).where(User.login_name == login)).one()


def test_seed_admin_accounts_login(client, db):
    for name in NEW_ACCOUNTS:
        res = client.post("/api/v1/auth/login", json={"login_name": name, "password": "dev123"})
        assert res.status_code == 200, name
        n = db.scalar(
            text("SELECT count(*) FROM teachers WHERE user_id = :u"), {"u": _user(db, name).id}
        )
        assert n == 1, name
    for name in ("principal01", "dean01", "itadmin01"):
        [bd] = db.scalars(
            select(RoleBinding).where(RoleBinding.user_id == _user(db, name).id)
        ).all()
        assert bd.academic_year_id is None
        assert bd.scope == {"school_id": SCHOOL_ID}
    [gh] = db.scalars(
        select(RoleBinding).where(RoleBinding.user_id == _user(db, "gradehead03").id)
    ).all()
    assert gh.role_type == "grade_head"
    assert gh.academic_year_id is not None
    assert list(gh.scope) == ["grade_id"]


def test_seed_existing_teacher_unchanged(client, settings):
    res = client.get("/api/v1/me/classes", headers=auth(settings, TEACHER_USER_ID))
    assert [c["name"] for c in res.json()["items"]] == ["三年二班"]


def test_seed_new_classes_and_students(db):
    classes = {
        c.name: c
        for c in db.scalars(select(SchoolClass).where(SchoolClass.school_id == UUID(SCHOOL_ID)))
    }
    assert set(classes) == {"三年二班", "三年一班", "四年一班"}
    for name, room in (("三年一班", "求知楼 202"), ("四年一班", "求知楼 301")):
        c = classes[name]
        assert (c.seat_rows, c.seat_cols, c.desk_size, c.seat_layout, c.room) == (
            6,
            4,
            2,
            "manual",
            room,
        )
        n = db.scalar(
            select(func.count())
            .select_from(Enrollment)
            .where(Enrollment.class_id == c.id, Enrollment.seat_row.is_not(None))
        )
        assert n == 6
    assert db.scalar(select(func.count()).select_from(Student)) == 22
    assert classes["三年一班"].homeroom_teacher_id is not None
    assert classes["四年一班"].homeroom_teacher_id is not None


def test_seed_attendance_confirmed(db):
    for name in ("三年二班", "三年一班", "四年一班"):
        cid = db.scalars(select(SchoolClass.id).where(SchoolClass.name == name)).one()
        if name != "三年二班":
            rows = db.scalars(select(Attendance).where(Attendance.class_id == cid)).all()
            assert 1 <= len(rows) <= 10
            assert all(date(2026, 10, 12) <= r.date <= date(2026, 10, 16) for r in rows)
        days = db.scalars(
            select(AttendanceDay.date).where(
                AttendanceDay.class_id == cid,
                AttendanceDay.date.between(date(2026, 10, 12), date(2026, 10, 16)),
            )
        ).all()
        assert len(days) == 5
