from tests.factories import make_class, make_student
from tests.helpers import audit_rows, auth, enrollment_of, freeze
from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID

SUMMARY = f"/api/v1/classes/{CLASS_ID}/classroom"
BOARD = f"/api/v1/classes/{CLASS_ID}/board"
ALL_PERMS = [
    "attendance.read",
    "attendance.write",
    "review.read",
    "review.write",
    "seating.write",
    "board.write",
    "student.write_basic",
    "exam.read",
    "exam.write",
    "score.write",
    "score.export",
    "student.manage",
    "student.export",
    "growth.read",
    "growth.write",
    "comment.read",
    "comment.write",
    "ai.use",
    "ai.class",
]
A_BOARD = {
    "left_title": "今日课程",
    "left_text": "1 语文\n2 数学",
    "right_title": "值日",
    "right_text": "王小一 李小二",
    "countdown_label": "期末考试",
    "countdown_date": "2027-01-15",
}


def test_summary_for_homeroom(client, settings, monkeypatch):
    freeze(monkeypatch, "2026-11-02T02:00:00+00:00")
    body = client.get(SUMMARY, headers=auth(settings)).json()
    assert (body["today"], body["timezone"]) == ("2026-11-02", "Asia/Shanghai")
    assert (body["week_no"], body["week_start"]) == (10, "2026-11-02")
    assert body["year"]["name"] == "2026-2027"
    assert body["seat_version"] == 0
    assert body["my_perms"] == ALL_PERMS
    assert body["my_subjects"] == []
    assert body["board"] == {
        "left_title": "今日课程",
        "left_text": "",
        "right_title": "今日事项",
        "right_text": "",
        "countdown_label": None,
        "countdown_date": None,
    }


def test_summary_for_subject_teacher(client, settings):
    body = client.get(SUMMARY, headers=auth(settings, SUBJECT_USER_ID)).json()
    assert body["my_perms"] == [
        "attendance.read",
        "review.read",
        "review.write",
        "exam.read",
        "exam.write",
        "score.write",
        "growth.read",
        "ai.use",
    ]
    assert body["my_subjects"] == ["数学"]


def test_summary_other_class_forbidden_and_audited(client, db, settings):
    other = make_class(db, "三年三班")
    res = client.get(f"/api/v1/classes/{other}/classroom", headers=auth(settings))
    assert res.status_code == 403
    assert [(r.action, r.success) for r in audit_rows(db, other)] == [("class.read", False)]


def test_board_roundtrip(client, settings):
    assert client.put(BOARD, json=A_BOARD, headers=auth(settings)).json() == A_BOARD
    assert client.get(SUMMARY, headers=auth(settings)).json()["board"] == A_BOARD


def test_board_validation(client, settings):
    five_lines = {**A_BOARD, "left_text": "1\n2\n3\n4\n5"}
    half_countdown = {**A_BOARD, "countdown_date": None}
    for bad in (five_lines, half_countdown, {**A_BOARD, "left_title": ""}):
        res = client.put(BOARD, json=bad, headers=auth(settings))
        assert (res.status_code, res.json()["error"]["code"]) == (400, "BAD_REQUEST")


def test_board_is_homeroom_only(client, settings):
    res = client.put(BOARD, json=A_BOARD, headers=auth(settings, ASSISTANT_USER_ID))
    assert res.status_code == 403


def test_roster_has_classroom_fields(client, settings):
    items = client.get(f"/api/v1/classes/{CLASS_ID}/students", headers=auth(settings)).json()
    wang = next(i for i in items["items"] if i["name"] == "王小一")
    assert (
        wang["gender"],
        wang["student_no"],
        wang["birthdate"],
        wang["class_role"],
        wang["seat_locked"],
    ) == ("男", "2026001", "2017-11-03", "班长", False)


def test_profile_has_enrollment_and_class_role(client, db, settings):
    wang = client.get(f"/api/v1/students/{STUDENT_IDS[0]}", headers=auth(settings)).json()
    assert wang["enrollment_id"] == str(enrollment_of(db, STUDENT_IDS[0]))
    assert wang["class_role"] == "班长"
    zhang = client.get(f"/api/v1/students/{STUDENT_IDS[2]}", headers=auth(settings)).json()
    assert "class_role" not in zhang


def test_set_class_role_is_audited(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[2])
    url = f"/api/v1/classes/{CLASS_ID}/students/{e}/class-role"
    res = client.put(url, json={"class_role": " 体育委员 "}, headers=auth(settings))
    assert res.json() == {"enrollment_id": str(e), "class_role": "体育委员"}
    assert [(r.action, r.success) for r in audit_rows(db, e)] == [
        ("student.update_class_role", True)
    ]
    assert client.put(url, json={"class_role": None}, headers=auth(settings)).json() == {
        "enrollment_id": str(e),
        "class_role": None,
    }
    eleven = "一二三四五六七八九十一"
    too_long = client.put(url, json={"class_role": eleven}, headers=auth(settings))
    assert too_long.status_code == 400


def test_set_class_role_rules(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[2])
    url = f"/api/v1/classes/{CLASS_ID}/students/{e}/class-role"
    as_assistant = client.put(
        url, json={"class_role": "班长"}, headers=auth(settings, ASSISTANT_USER_ID)
    )
    assert as_assistant.status_code == 403
    outsider = enrollment_of(db, make_student(db, make_class(db, "三年三班"), "外班生", "S9001"))
    res = client.put(
        f"/api/v1/classes/{CLASS_ID}/students/{outsider}/class-role",
        json={"class_role": "班长"},
        headers=auth(settings),
    )
    assert res.status_code == 404


def test_board_put_requires_every_field(client, settings):
    for bad in ({}, {k: v for k, v in A_BOARD.items() if k != "countdown_date"}):
        res = client.put(BOARD, json=bad, headers=auth(settings))
        assert (res.status_code, res.json()["error"]["code"]) == (400, "BAD_REQUEST")
    assert client.get(SUMMARY, headers=auth(settings)).json()["board"]["left_title"] == "今日课程"


def test_board_strips_titles_and_label(client, settings):
    blank_title = {**A_BOARD, "left_title": "   "}
    blank_label = {**A_BOARD, "countdown_label": ""}
    for bad in (blank_title, blank_label):
        res = client.put(BOARD, json=bad, headers=auth(settings))
        assert (res.status_code, res.json()["error"]["code"]) == (400, "BAD_REQUEST")
    padded = {**A_BOARD, "left_title": " 课程 ", "countdown_label": " 期末 "}
    res = client.put(BOARD, json=padded, headers=auth(settings))
    assert (res.json()["left_title"], res.json()["countdown_label"]) == ("课程", "期末")
    no_countdown = {**A_BOARD, "countdown_label": "  ", "countdown_date": None}
    assert (
        client.put(BOARD, json=no_countdown, headers=auth(settings)).json()["countdown_label"]
        is None
    )


def test_second_board_put_overwrites_first(client, settings):
    other = {**A_BOARD, "left_text": "改了", "countdown_label": None, "countdown_date": None}
    client.put(BOARD, json=A_BOARD, headers=auth(settings))
    assert client.put(BOARD, json=other, headers=auth(settings)).json() == other
    assert client.get(SUMMARY, headers=auth(settings)).json()["board"] == other


def test_class_role_body_requires_key(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[2])
    url = f"/api/v1/classes/{CLASS_ID}/students/{e}/class-role"
    client.put(url, json={"class_role": "班长"}, headers=auth(settings))
    res = client.put(url, json={}, headers=auth(settings))
    assert res.status_code == 400
    assert client.get(SUMMARY, headers=auth(settings)).status_code == 200
