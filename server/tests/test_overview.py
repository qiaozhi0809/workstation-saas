from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, event, select, update

from app.domain.overview.service import board_view
from app.models import (
    Attendance,
    AttendanceDay,
    Enrollment,
    Exam,
    Grade,
    GradeExam,
    Review,
    SchoolClass,
    Score,
    Student,
    User,
)
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings
from app.rbac.roles import Role
from tests.factories import bind, make_admin, make_class, make_student
from tests.helpers import auth, freeze
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, YEAR_ID

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


def test_board_classes_sorted_by_class_sort_key(client, db, settings, monkeypatch):
    """L40:看板班级按班名数值排(三年三班在三年二班之后、三年十班最后),不按码位。"""
    freeze(monkeypatch, NOW)
    for name in ("三年十班", "三年三班"):
        make_class(db, name)
    body = get_board(client, settings).json()
    assert [c["name"] for c in body["classes"]] == ["三年一班", "三年二班", "三年三班", "三年十班"]
    today = get_today(client, settings).json()
    unconfirmed = [c["class_name"] for c in today["unconfirmed"]]
    expected = ["三年一班", "三年二班", "三年三班", "三年十班", "四年一班"]
    assert unconfirmed == [n for n in expected if n in unconfirmed]


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
    # 8 条 + M5c 每班摄像头数的 2 条(开关、计数),与班数无关
    assert len(statements) <= 10, statements


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


def get_detail(client, settings, class_id, user=PRINCIPAL):
    return client.get(f"/api/v1/admin/board/classes/{class_id}", headers=auth(settings, user))


def test_board_class_detail_principal(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_by_mk(db, "S0013")
    db.add(
        Attendance(
            enrollment_id=e.id, class_id=e.class_id, date=TODAY, status="leave", reason="感冒"
        )
    )
    db.flush()
    res = get_detail(client, settings, C31)
    assert res.status_code == 200
    body = res.json()
    card = next(c for c in get_board(client, settings).json()["classes"] if c["id"] == C31)
    assert {k: v for k, v in body.items() if k != "absentees"} == card
    assert [(a["name"], a["status"], a["reason"]) for a in body["absentees"]] == [
        ("曹小三", "leave", "感冒")
    ]
    students = client.get(f"/api/v1/classes/{C31}/students", headers=auth(settings, PRINCIPAL))
    assert body["seats"] == students.json()["items"]


def test_board_class_detail_grade_head_scope(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    assert get_detail(client, settings, CLASS_ID, GRADE_HEAD3).status_code == 200
    assert get_detail(client, settings, C41, GRADE_HEAD3).status_code == 403
    row = db.scalars(
        select(AuditLog).where(AuditLog.user_id == UUID(GRADE_HEAD3), AuditLog.success.is_(False))
    ).first()
    assert row is not None and row.object_id == C41
    bind(db, UUID(GRADE_HEAD3), Role.homeroom_teacher, class_id=C41)
    assert get_detail(client, settings, C41, GRADE_HEAD3).status_code == 403


def test_board_class_detail_it_admin_and_missing(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    assert get_detail(client, settings, C31, IT_ADMIN).status_code == 403
    missing = uuid4()
    assert get_detail(client, settings, missing).status_code == 403
    row = db.scalars(
        select(AuditLog).where(AuditLog.user_id == UUID(PRINCIPAL), AuditLog.success.is_(False))
    ).one()
    assert (row.action, row.object_id) == ("school.view", str(missing))


def test_board_class_detail_inactive_class_forbidden(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    cid = make_class(db, "三年八班")
    db.execute(update(SchoolClass).where(SchoolClass.id == cid).values(active=False))
    db.flush()
    assert get_detail(client, settings, cid).status_code == 403


def test_grade_head_of_empty_grade(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    g5 = Grade(
        school_id=UUID(SCHOOL_ID),
        academic_year_id=UUID(YEAR_ID),
        name="五年级",
        display_order=5,
    )
    db.add(g5)
    db.flush()
    user = make_admin(db, SCHOOL_ID, Role.grade_head.value, grade=g5.id)
    today = get_today(client, settings, user.id).json()
    assert today["scope_label"] == "五年级"
    assert (today["totals"]["classes"], today["totals"]["students"]) == (0, 0)
    board = get_board(client, settings, user.id).json()
    assert board["grades"] == [{"id": str(g5.id), "name": "五年级"}]
    assert (board["grade_id"], board["classes"]) == (str(g5.id), [])


def test_leader_classroom_my_perms_has_no_write_perms(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for user in (PRINCIPAL, GRADE_HEAD3):
        res = client.get(f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings, user))
        assert res.status_code == 200
        perms = set(res.json()["my_perms"])
        assert perms == {
            "attendance.read",
            "review.read",
            "exam.read",
            "score.export",
            "student.export",
            "growth.read",
            "comment.read",
        }
        writes = {p for p in perms if not p.endswith(".read") and not p.endswith(".export")}
        assert writes == set()


def test_me_classes_excludes_unassigned_classes_for_principal(client, db, settings):
    res = client.get("/api/v1/me/classes", headers=auth(settings, PRINCIPAL))
    assert res.json()["items"] == []


_AT = datetime(2026, 10, 1, 8, 0, tzinfo=UTC)


def _grade_exam(db, grade_id, name, day, created, subjects=("语文", "数学")):
    ge = GradeExam(
        school_id=UUID(SCHOOL_ID),
        academic_year_id=UUID(YEAR_ID),
        grade_id=UUID(grade_id),
        name=name,
        exam_type="期中",
        date=day,
        subjects=[{"name": s, "full": 100} for s in subjects],
        created_at=created,
    )
    db.add(ge)
    db.flush()
    return ge


def _class_exam(db, class_id, ge, scores):
    """scores: [(学生 mk, 科目)];每行记一个有分数的格子。"""
    exam = Exam(
        class_id=UUID(class_id),
        academic_year_id=UUID(YEAR_ID),
        name=ge.name,
        exam_type=ge.exam_type,
        date=ge.date,
        subjects=ge.subjects,
        grade_exam_id=ge.id,
    )
    db.add(exam)
    db.flush()
    for mk, subject in scores:
        db.add(
            Score(
                exam_id=exam.id,
                enrollment_id=enrollment_by_mk(db, mk).id,
                subject=subject,
                value=90,
            )
        )
    db.flush()


def test_grade_exam_card_matches_grade_exam_progress(client, db, settings, monkeypatch):
    """今日关注的联考进度与联考管理页共用 grade_exams.service.progress,不各算一份。"""
    from app.domain.grade_exams.service import progress

    freeze(monkeypatch, NOW)
    ge = _grade_exam(db, GRADE_ID, "三年级期中联考", date(2026, 10, 10), _AT)
    mks = ["S0011", "S0012", "S0013"]
    _class_exam(db, C31, ge, [(m, "语文") for m in mks] + [("S0011", "数学")])
    card = get_today(client, settings, GRADE_HEAD3).json()["grade_exam"]
    rows = progress(db, ge)
    assert rows and card["entered"] == sum(r.entered for r in rows) == 4
    assert card["expected"] == sum(r.expected for r in rows)


def test_today_notice_and_grade_exam_cards(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    # 无联考 / 无通知
    body = get_today(client, settings).json()
    assert body["grade_exam"] is None and body["my_notices"] == []

    old = _grade_exam(db, GRADE_ID, "三年级月考", date(2026, 9, 20), _AT)
    new3 = _grade_exam(db, GRADE_ID, "三年级期中联考", date(2026, 10, 10), _AT)
    new4 = _grade_exam(db, G4, "四年级期中联考", date(2026, 10, 12), _AT)
    _class_exam(db, C31, old, [("S0011", "语文")])  # 旧联考的分数不计
    # 三年一班 6 人:语文 6 格 + 数学 2 格 + 联考外科目 1 格;三年二班没有班级考试,不计
    mks = ["S0011", "S0012", "S0013", "S0014", "S0015", "S0016"]
    _class_exam(
        db,
        C31,
        new3,
        [(m, "语文") for m in mks] + [("S0011", "数学"), ("S0012", "数学"), ("S0011", "英语")],
    )
    body = get_today(client, settings).json()
    assert body["grade_exam"] == {
        "id": str(new4.id),
        "name": "四年级期中联考",
        "grade_name": "四年级",
        "entered": 0,
        "expected": 0,
    }
    gh = get_today(client, settings, GRADE_HEAD3).json()
    assert gh["grade_exam"] == {
        "id": str(new3.id),
        "name": "三年级期中联考",
        "grade_name": "三年级",
        "entered": 8,
        "expected": 12,
    }
    # 同日期按创建时间取最近一场
    tie = _grade_exam(db, GRADE_ID, "三年级补考", date(2026, 10, 10), _AT.replace(minute=5))
    assert get_today(client, settings, GRADE_HEAD3).json()["grade_exam"]["id"] == str(tie.id)
    # 信息中心没有 school.view
    assert get_today(client, settings, IT_ADMIN).status_code == 403

    # 我发的通知:最近 3 条未撤回
    ids = []
    for n in range(4):
        freeze(monkeypatch, f"2026-10-14T0{n}:00:00+00:00")
        res = client.post(
            "/api/v1/admin/notices",
            json={
                "title": f"通知{n}",
                "content": "内容",
                "target": {"kind": "class", "class_id": CLASS_ID},
            },
            headers=auth(settings, PRINCIPAL),
        )
        assert res.status_code == 201, res.text
        ids.append(res.json()["id"])
    client.post(f"/api/v1/notices/{ids[3]}/read", headers=auth(settings, T01))
    client.post(f"/api/v1/notices/{ids[2]}/read", headers=auth(settings, T01))
    client.post(f"/api/v1/admin/notices/{ids[2]}/recall", headers=auth(settings, PRINCIPAL))
    freeze(monkeypatch, NOW)
    mine = get_today(client, settings).json()["my_notices"]
    assert [n["id"] for n in mine] == [ids[3], ids[1], ids[0]]
    assert [(n["title"], n["recipients"], n["read"]) for n in mine] == [
        ("通知3", 3, 1),
        ("通知1", 3, 0),
        ("通知0", 3, 0),
    ]
    assert mine[0]["created_at"].startswith("2026-10-14T03:00:00")
    assert get_today(client, settings, DEAN).json()["my_notices"] == []


def test_today_my_notices_without_visible_classes(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    db.execute(update(SchoolClass).values(active=False))
    db.flush()
    res = client.post(
        "/api/v1/admin/notices",
        json={"title": "空校", "content": "内容", "target": {"kind": "school"}},
        headers=auth(settings, PRINCIPAL),
    )
    assert res.status_code == 201, res.text
    body = get_today(client, settings).json()
    assert body["totals"]["classes"] == 0
    assert body["grade_exam"] is None
    assert [n["title"] for n in body["my_notices"]] == ["空校"]


def _cams_by_class(body):
    return {c["name"]: c["cameras"] for c in body["classes"]}


def test_board_camera_counts(client, db, settings, monkeypatch):
    from app.domain.school_settings.service import get_switches, save_switches
    from app.models.cameras import Camera

    freeze(monkeypatch, NOW)
    school = UUID(SCHOOL_ID)

    def cam(class_id, enabled=True):
        db.add(
            Camera(
                school_id=school,
                name="cam",
                class_id=UUID(class_id) if class_id else None,
                location="教室",
                rtsp_url="rtsp://10.0.0.21/live/1",
                enabled=enabled,
            )
        )

    cam(CLASS_ID)
    cam(CLASS_ID)
    cam(CLASS_ID, enabled=False)
    cam(C31)
    cam(C41)
    db.flush()
    # 开关关:全部 0
    assert set(_cams_by_class(get_board(client, settings).json()).values()) == {0}
    sw = get_switches(db, school)
    save_switches(db, school, UUID(IT_ADMIN), sw.model_copy(update={"monitor": True}))
    body = get_board(client, settings).json()
    assert _cams_by_class(body) == {"三年一班": 1, "三年二班": 2}
    assert _cams_by_class(get_board(client, settings, grade_id=G4).json()) == {"四年一班": 1}
    # 年级组长看本年级;班详情同口径
    assert _cams_by_class(get_board(client, settings, GRADE_HEAD3).json()) == {
        "三年一班": 1,
        "三年二班": 2,
    }
    detail = client.get(f"/api/v1/admin/board/classes/{CLASS_ID}", headers=auth(settings, DEAN))
    assert detail.status_code == 200 and detail.json()["cameras"] == 2
