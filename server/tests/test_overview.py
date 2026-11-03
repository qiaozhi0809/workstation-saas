from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, event, select

from app.domain.overview.service import board_view
from app.models import Attendance, AttendanceDay, Enrollment, Review, Student, User
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings
from app.rbac.roles import Role
from tests.factories import bind, make_class, make_student
from tests.helpers import auth, freeze
from tests.seed_ids import CLASS_ID, GRADE_ID, YEAR_ID

NOW = "2026-10-14T02:00:00+00:00"  # 学校时区 2026-10-14(周三)10:00,本周一 = 10-12
TODAY = date(2026, 10, 14)
G4 = "33333333-3333-3333-3333-333333333334"
C31 = "44444444-4444-4444-4444-444444444441"
C41 = "44444444-4444-4444-4444-444444444442"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
T01 = "55555555-5555-5555-5555-555555555555"
T04 = "55555555-5555-5555-5555-555555555541"
T05 = "55555555-5555-5555-5555-555555555542"


def get_today(client, settings, user=PRINCIPAL):
    return client.get("/api/v1/admin/today", headers=auth(settings, user))


def get_board(client, settings, user=PRINCIPAL, grade_id=None):
    params = {} if grade_id is None else {"grade_id": grade_id}
    return client.get("/api/v1/admin/board", params=params, headers=auth(settings, user))


def enrollment_by_mk(db, mk: str) -> Enrollment:
    return db.scalars(
        select(Enrollment)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Student.mk == mk, Enrollment.status == "active")
    ).one()


def review(db, mk, delta, user, *, at="2026-10-13T03:00:00+00:00", revoked=False):
    e = enrollment_by_mk(db, mk)
    db.add(
        Review(
            op_id=uuid4(),
            enrollment_id=e.id,
            class_id=e.class_id,
            category="individual",
            reason_text="测试",
            score_delta=delta,
            given_by_user_id=UUID(user),
            given_at=datetime.fromisoformat(at),
            revoked_at=datetime(2026, 10, 13, 5, tzinfo=UTC) if revoked else None,
        )
    )
    db.flush()


def test_today_totals(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    # 种子 10-14:S0004 迟到(三年二班)、S0021 缺勤(四年一班),三个班均已确认;再加一个请假
    e = enrollment_by_mk(db, "S0013")
    db.add(
        Attendance(
            enrollment_id=e.id, class_id=e.class_id, date=TODAY, status="leave", reason="感冒"
        )
    )
    db.execute(
        delete(AttendanceDay).where(
            AttendanceDay.class_id == UUID(C31), AttendanceDay.date == TODAY
        )
    )
    db.flush()
    body = get_today(client, settings).json()
    assert body["date"] == "2026-10-14"
    assert body["scope_label"] == "全校"
    assert body["totals"] == {
        "students": 22,
        "present": 20,
        "leave": 1,
        "absent": 1,
        "late": 1,
        "classes": 3,
        "confirmed_classes": 2,
    }
    got = {(a["class_name"], a["name"], a["status"], a["reason"]) for a in body["absentees"]}
    assert got == {("三年一班", "曹小三", "leave", "感冒"), ("四年一班", "谢小一", "absent", None)}
    assert body["unconfirmed"] == [
        {"class_id": C31, "class_name": "三年一班", "homeroom_name": "孙老师"}
    ]


def test_today_without_records(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    db.execute(delete(Attendance).where(Attendance.date == TODAY))
    db.execute(delete(AttendanceDay).where(AttendanceDay.date == TODAY))
    db.flush()
    body = get_today(client, settings).json()
    assert body["totals"] == {
        "students": 22,
        "present": 22,
        "leave": 0,
        "absent": 0,
        "late": 0,
        "classes": 3,
        "confirmed_classes": 0,
    }
    assert body["absentees"] == []
    assert [u["class_name"] for u in body["unconfirmed"]] == ["三年一班", "三年二班", "四年一班"]
    wr = body["week_reviews"]
    assert [(c["plus"], c["minus"], c["net"]) for c in wr["classes"]] == [(0, 0, 0)] * 3
    assert wr["bottom"] == [] and wr["teachers"] == []


def test_today_week_reviews(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    review(db, "S0011", 3, T04)
    review(db, "S0011", 2, T04)
    review(db, "S0012", -4, T04)
    review(db, "S0011", 5, T04, revoked=True)  # 已撤销,不算
    review(db, "S0013", -9, T04, at="2026-10-11T03:00:00+00:00")  # 上周,不算
    review(db, "S0017", 1, T05)
    review(db, "S0001", -2, T01)
    wr = get_today(client, settings).json()["week_reviews"]
    assert wr["classes"] == [
        {"class_id": C31, "class_name": "三年一班", "plus": 5, "minus": 4, "net": 1},
        {"class_id": C41, "class_name": "四年一班", "plus": 1, "minus": 0, "net": 1},
        {"class_id": CLASS_ID, "class_name": "三年二班", "plus": 0, "minus": 2, "net": -2},
    ]
    s1 = db.scalars(select(Student.name).where(Student.mk == "S0001")).one()
    assert [(b["name"], b["net"]) for b in wr["bottom"]] == [("孔小二", -4), (s1, -2)]
    assert wr["bottom"][0]["class_name"] == "三年一班"
    assert wr["teachers"][0] == {"user_id": T04, "display_name": "孙老师", "count": 3}
    assert {t["user_id"]: t["count"] for t in wr["teachers"]} == {T04: 3, T05: 1, T01: 1}


def test_bottom_only_negative_and_at_most_five(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for i in range(11, 17):
        review(db, f"S00{i}", -1, T04)
    review(db, "S0017", 4, T05)
    bottom = get_today(client, settings).json()["week_reviews"]["bottom"]
    assert len(bottom) == 5
    assert all(b["net"] == -1 for b in bottom)


def test_grade_head_today_scoped_to_grade(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    review(db, "S0017", -3, T05)  # 四年级的点评,年级组长看不到
    body = get_today(client, settings, GRADE_HEAD3).json()
    assert body["scope_label"] == "三年级"
    assert body["totals"]["classes"] == 2
    assert body["totals"]["students"] == 16
    assert {a["class_name"] for a in body["absentees"]} <= {"三年一班", "三年二班"}
    assert {c["class_name"] for c in body["week_reviews"]["classes"]} == {"三年一班", "三年二班"}
    assert body["week_reviews"]["bottom"] == []


def test_it_admin_cannot_see_today(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for path in ("/api/v1/admin/today", "/api/v1/admin/board"):
        res = client.get(path, headers=auth(settings, IT_ADMIN))
        assert res.status_code == 403
    rows = db.scalars(
        select(AuditLog).where(AuditLog.user_id == UUID(IT_ADMIN), AuditLog.action == "school.view")
    ).all()
    assert len(rows) == 2
    assert all(r.success is False for r in rows)


def test_teacher_cannot_see_today(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    assert get_today(client, settings, T01).status_code == 403
    assert get_board(client, settings, T01).status_code == 403


def test_dean_sees_whole_school(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    assert get_today(client, settings, DEAN).json()["totals"]["classes"] == 3


def test_board_default_grade_and_attendance_map(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    body = get_board(client, settings).json()
    assert body["grades"] == [{"id": GRADE_ID, "name": "三年级"}, {"id": G4, "name": "四年级"}]
    assert body["grade_id"] == GRADE_ID
    assert [c["name"] for c in body["classes"]] == ["三年一班", "三年二班"]
    one, two = body["classes"]
    assert (one["id"], one["room"], one["homeroom_name"]) == (C31, "求知楼 202", "孙老师")
    assert (one["seat_rows"], one["seat_cols"], one["desk_size"]) == (6, 4, 2)
    assert (one["podium_left"], one["podium_right"]) == (0, 0)
    assert len(one["seats"]) == 6
    assert set(one["seats"][0]) == {
        "enrollment_id",
        "student_id",
        "name",
        "mk",
        "seat_row",
        "seat_col",
        "avatar_seed",
        "gender",
        "student_no",
        "birthdate",
        "class_role",
        "seat_locked",
    }
    # 三年二班:S0004 迟到;只有非出勤学生进 attendance
    s4 = enrollment_by_mk(db, "S0004")
    assert two["attendance"] == {str(s4.id): "late"}
    assert one["attendance"] == {}
    assert two["metrics"] == {
        "students": 10,
        "present": 10,
        "leave": 0,
        "absent": 0,
        "late": 1,
        "confirmed": True,
        "week_net": 0,
    }
    assert one["metrics"]["students"] == 6


def test_board_podium_and_desk_fields_follow_class(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    cid = make_class(
        db, "三年九班", desk_size=3, podium_left=1, podium_right=2, seat_rows=5, seat_cols=6
    )
    make_student(db, cid, "测试生", "S9001")
    two = next(c for c in get_board(client, settings).json()["classes"] if c["id"] == str(cid))
    assert (two["desk_size"], two["podium_left"], two["podium_right"], two["seat_rows"]) == (
        3,
        1,
        2,
        5,
    )
    assert two["metrics"]["confirmed"] is False
    assert two["homeroom_name"] is None


def test_board_explicit_grade(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    review(db, "S0017", 2, T05)
    review(db, "S0017", 1, T05, revoked=True)
    body = get_board(client, settings, grade_id=G4).json()
    assert body["grade_id"] == G4
    [c] = body["classes"]
    assert c["name"] == "四年一班"
    assert c["metrics"]["week_net"] == 2
    assert c["metrics"]["absent"] == 1 and c["metrics"]["present"] == 5


def test_board_grade_head_sees_only_own_grade(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    body = get_board(client, settings, GRADE_HEAD3).json()
    assert body["grades"] == [{"id": GRADE_ID, "name": "三年级"}]
    assert body["grade_id"] == GRADE_ID


def test_grade_head_board_other_grade_forbidden(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    res = get_board(client, settings, GRADE_HEAD3, grade_id=G4)
    assert res.status_code == 403
    row = db.scalars(
        select(AuditLog).where(AuditLog.user_id == UUID(GRADE_HEAD3), AuditLog.success.is_(False))
    ).first()
    assert row is not None and row.action == "school.view"


def test_board_query_count(db, monkeypatch):
    freeze(monkeypatch, NOW)
    for i in range(10):
        cid = make_class(db, f"三年{20 + i}班")
        make_student(db, cid, f"学生{i}", f"S91{i:02d}")
    user = db.scalars(select(User).where(User.login_name == "principal01")).one()
    bindings = load_bindings(db, user.id, UUID(YEAR_ID))
    statements: list[str] = []

    def count(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    conn = db.connection()
    event.listen(conn, "before_cursor_execute", count)
    try:
        view = board_view(db, user, bindings, UUID(GRADE_ID), None)
    finally:
        event.remove(conn, "before_cursor_execute", count)
    assert len(view.classes) == 12
    assert len(statements) <= 8, statements


def test_grade_head_also_homeroom_elsewhere_stays_scoped(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    bind(db, UUID(GRADE_HEAD3), Role.homeroom_teacher, class_id=C41)
    body = get_today(client, settings, GRADE_HEAD3).json()
    assert body["scope_label"] == "三年级"
    assert body["totals"]["classes"] == 2
    assert {u["class_name"] for u in body["unconfirmed"]} <= {"三年一班", "三年二班"}
    board = get_board(client, settings, GRADE_HEAD3)
    assert board.json()["grades"] == [{"id": GRADE_ID, "name": "三年级"}]
    assert get_board(client, settings, GRADE_HEAD3, grade_id=G4).status_code == 403


def test_board_seats_equal_class_students_endpoint(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for c in get_board(client, settings).json()["classes"]:
        res = client.get(f"/api/v1/classes/{c['id']}/students", headers=auth(settings, PRINCIPAL))
        assert c["seats"] == res.json()["items"]


def test_leaders_read_class_endpoints_within_scope(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for user in (PRINCIPAL, GRADE_HEAD3):
        h = auth(settings, user)
        base = f"/api/v1/classes/{CLASS_ID}"
        assert client.get(f"{base}/classroom", headers=h).status_code == 200
        assert client.get(f"{base}/students", headers=h).status_code == 200
        assert (
            client.get(f"{base}/attendance", params={"date": "2026-10-14"}, headers=h).status_code
            == 200
        )


def test_grade_head_cannot_read_other_grade_class(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    h = auth(settings, GRADE_HEAD3)
    base = f"/api/v1/classes/{C41}"
    assert client.get(f"{base}/classroom", headers=h).status_code == 403
    assert client.get(f"{base}/students", headers=h).status_code == 403
    assert (
        client.get(f"{base}/attendance", params={"date": "2026-10-14"}, headers=h).status_code
        == 403
    )
