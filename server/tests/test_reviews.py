from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.models import Attendance, Enrollment, Review, Student
from app.rbac.roles import Role
from tests.factories import bind, make_user
from tests.helpers import audit_rows, auth, enrollment_of, freeze
from tests.seed_ids import CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID, TEACHER_USER_ID

BASE = f"/api/v1/classes/{CLASS_ID}/reviews"
NOW = "2026-11-02T02:00:00+00:00"


def individual(enrollments, op_id=None, delta=1, reason="积极发言", **extra):
    return {
        "op_id": str(op_id or uuid4()),
        "category": "individual",
        "enrollment_ids": [str(e) for e in enrollments],
        "reason_text": reason,
        "score_delta": delta,
        **extra,
    }


def whole_class(op_id=None):
    return {
        "op_id": str(op_id or uuid4()),
        "category": "whole_class",
        "reason_text": "全班表现好",
        "score_delta": 1,
    }


def mark(db, student_id, status, day="2026-11-02"):
    db.add(
        Attendance(
            enrollment_id=enrollment_of(db, student_id),
            class_id=UUID(CLASS_ID),
            date=date.fromisoformat(day),
            status=status,
        )
    )
    db.flush()


def review_count(db):
    return db.scalar(select(func.count()).select_from(Review))


def test_create_individual_review(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[0])
    res = client.post(BASE, json=individual([e]), headers=auth(settings))
    assert res.status_code == 201
    [item] = res.json()["items"]
    assert (item["enrollment_id"], item["score_delta"]) == (str(e), 1)
    assert item["category"] == "individual"
    assert (item["given_by_me"], item["subject"]) == (True, None)
    assert "given_by_user_id" not in item
    name = db.scalar(select(Student.name).where(Student.id == UUID(STUDENT_IDS[0])))
    assert (item["student_name"], item["transferred"]) == (name, False)


def test_replayed_op_id_returns_existing_rows(client, db, settings):
    payload = individual([enrollment_of(db, STUDENT_IDS[0])])
    first = client.post(BASE, json=payload, headers=auth(settings))
    second = client.post(BASE, json=payload, headers=auth(settings))
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["items"] == first.json()["items"]
    assert review_count(db) == 1


def test_op_id_reused_by_other_user_is_409(client, db, settings):
    payload = individual([enrollment_of(db, STUDENT_IDS[0])])
    client.post(BASE, json=payload, headers=auth(settings))
    res = client.post(BASE, json=payload, headers=auth(settings, SUBJECT_USER_ID))
    assert (res.status_code, res.json()["error"]["code"]) == (409, "OP_ID_CONFLICT")


def test_concurrent_same_op_id_rolls_back_and_replays(client, db, settings, monkeypatch):
    """两个同 op_id 的请求赛跑:查重时还没有,插入时已被先到者写入 → 撞唯一键后回滚,
    改为返回先到者的行(200),库里不留第二套、也不留半套(L19)。"""
    from app.domain.reviews import service as reviews

    e = enrollment_of(db, STUDENT_IDS[0])
    payload = individual([e])
    real = reviews._existing
    calls = {"n": 0}

    def racing_existing(db_, cls, user_id, op_id):
        found = real(db_, cls, user_id, op_id)
        calls["n"] += 1
        if calls["n"] == 1:
            # 查重之后、插入之前,另一个同 op_id 的请求已经提交了同样的行
            db.add(
                Review(
                    op_id=op_id,
                    enrollment_id=e,
                    class_id=UUID(CLASS_ID),
                    category="individual",
                    reason_text="积极发言",
                    score_delta=1,
                    given_by_user_id=UUID(TEACHER_USER_ID),
                )
            )
            db.commit()
        return found

    monkeypatch.setattr(reviews, "_existing", racing_existing)
    res = client.post(BASE, json=payload, headers=auth(settings))
    assert res.status_code == 200, res.text
    assert [(i["enrollment_id"], i["given_by_me"]) for i in res.json()["items"]] == [(str(e), True)]
    assert calls["n"] == 2 and review_count(db) == 1
    # 会话已从失败的插入里恢复,后续请求照常
    assert client.get(BASE, headers=auth(settings)).status_code == 200


def test_whole_class_skips_leave_and_absent(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    mark(db, STUDENT_IDS[0], "leave")
    mark(db, STUDENT_IDS[1], "absent")
    mark(db, STUDENT_IDS[2], "late")
    items = client.post(BASE, json=whole_class(), headers=auth(settings)).json()["items"]
    got = {i["enrollment_id"] for i in items}
    assert len(got) == 8
    assert str(enrollment_of(db, STUDENT_IDS[2])) in got
    assert str(enrollment_of(db, STUDENT_IDS[0])) not in got
    assert {i["category"] for i in items} == {"whole_class"}


def test_whole_class_all_on_leave_is_400(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for sid in STUDENT_IDS:
        mark(db, sid, "leave")
    res = client.post(BASE, json=whole_class(), headers=auth(settings))
    assert (res.status_code, res.json()["error"]["code"]) == (400, "NO_TARGETS")
    assert review_count(db) == 0


def test_body_shape_rules(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[0])
    with_ids = {**whole_class(), "enrollment_ids": [str(e)]}
    zero = individual([e], delta=0)
    duplicated = individual([e, e])
    for bad in (with_ids, zero, duplicated):
        assert client.post(BASE, json=bad, headers=auth(settings)).status_code == 400
    unknown = client.post(BASE, json=individual([uuid4()]), headers=auth(settings))
    assert unknown.json()["error"]["code"] == "UNKNOWN_ENROLLMENT"


def test_subject_rules(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[0])
    math = client.post(BASE, json=individual([e]), headers=auth(settings, SUBJECT_USER_ID))
    assert math.json()["items"][0]["subject"] == "数学"
    english = client.post(
        BASE, json=individual([e], subject="英语"), headers=auth(settings, SUBJECT_USER_ID)
    )
    assert english.json()["error"]["code"] == "SUBJECT_NOT_ALLOWED"
    two = make_user(db, "t_two_subjects")
    bind(db, two.id, Role.subject_teacher, class_id=CLASS_ID, subject="物理")
    bind(db, two.id, Role.subject_teacher, class_id=CLASS_ID, subject="化学")
    missing = client.post(BASE, json=individual([e]), headers=auth(settings, two.id))
    assert missing.json()["error"]["code"] == "SUBJECT_REQUIRED"
    chosen = client.post(BASE, json=individual([e], subject="化学"), headers=auth(settings, two.id))
    assert chosen.json()["items"][0]["subject"] == "化学"


def test_list_hides_givers_and_revoked(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[0])
    theirs, mine = uuid4(), uuid4()
    client.post(BASE, json=individual([e], op_id=theirs), headers=auth(settings, SUBJECT_USER_ID))
    client.post(BASE, json=individual([e], op_id=mine), headers=auth(settings))
    client.post(f"{BASE}/{mine}/revoke", headers=auth(settings))
    items = client.get(BASE, headers=auth(settings)).json()["items"]
    assert [(i["op_id"], i["given_by_me"]) for i in items] == [(str(theirs), False)]


def test_list_marks_transferred_student_with_name(client, db, settings):
    e0, e1 = enrollment_of(db, STUDENT_IDS[0]), enrollment_of(db, STUDENT_IDS[1])
    client.post(BASE, json=individual([e0, e1]), headers=auth(settings))
    db.execute(
        Enrollment.__table__.update().where(Enrollment.id == e1).values(status="transferred")
    )
    db.flush()
    items = client.get(BASE, headers=auth(settings)).json()["items"]
    by_enrollment = {i["enrollment_id"]: i for i in items}
    names = {
        s.id: s.name
        for s in db.scalars(select(Student).where(Student.id.in_(map(UUID, STUDENT_IDS[:2]))))
    }
    assert by_enrollment[str(e0)]["student_name"] == names[UUID(STUDENT_IDS[0])]
    assert by_enrollment[str(e0)]["transferred"] is False
    assert by_enrollment[str(e1)]["student_name"] == names[UUID(STUDENT_IDS[1])]
    assert by_enrollment[str(e1)]["transferred"] is True


def test_list_hides_removed_student_keeps_transferred(client, db, settings):
    e0, e1, e2 = (enrollment_of(db, STUDENT_IDS[i]) for i in range(3))
    for e in (e0, e1, e2):
        client.post(BASE, json=individual([e]), headers=auth(settings))
    db.execute(
        Enrollment.__table__.update().where(Enrollment.id == e1).values(status="transferred")
    )
    db.flush()
    res = client.delete(f"/api/v1/classes/{CLASS_ID}/students/{e2}", headers=auth(settings))
    assert res.status_code == 204
    items = client.get(BASE, headers=auth(settings)).json()["items"]
    by_enrollment = {i["enrollment_id"]: i for i in items}
    assert set(by_enrollment) == {str(e0), str(e1)}
    assert by_enrollment[str(e1)]["transferred"] is True
    assert by_enrollment[str(e1)]["student_name"]
    assert by_enrollment[str(e0)]["transferred"] is False


def test_list_pages_stay_full_when_removed_rows_interleave(client, db, settings):
    keep, gone = enrollment_of(db, STUDENT_IDS[0]), enrollment_of(db, STUDENT_IDS[1])
    for e in (keep, gone, keep, gone, keep):
        client.post(BASE, json=individual([e]), headers=auth(settings))
    res = client.delete(f"/api/v1/classes/{CLASS_ID}/students/{gone}", headers=auth(settings))
    assert res.status_code == 204
    page1 = client.get(BASE, params={"limit": 2}, headers=auth(settings)).json()
    assert len(page1["items"]) == 2 and page1["next_cursor"]
    page2 = client.get(
        BASE, params={"limit": 2, "cursor": page1["next_cursor"]}, headers=auth(settings)
    ).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
    assert {i["enrollment_id"] for i in page1["items"] + page2["items"]} == {str(keep)}


def test_list_paginates_without_overlap(client, db, settings):
    e = enrollment_of(db, STUDENT_IDS[0])
    for _ in range(3):
        client.post(BASE, json=individual([e]), headers=auth(settings))
    page1 = client.get(BASE, params={"limit": 2}, headers=auth(settings)).json()
    page2 = client.get(
        BASE, params={"limit": 2, "cursor": page1["next_cursor"]}, headers=auth(settings)
    ).json()
    ids = [i["id"] for i in page1["items"] + page2["items"]]
    assert len(page1["items"]) == 2 and page2["next_cursor"] is None
    assert len(set(ids)) == 3
    bad = client.get(BASE, params={"cursor": "not-a-cursor"}, headers=auth(settings))
    assert bad.status_code == 400


def test_summary_counts_week_and_total(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_of(db, STUDENT_IDS[0])
    for delta, at in (
        (2, "2026-11-01T15:00:00+00:00"),  # 学校时区 11-01 23:00,上周
        (3, "2026-11-01T16:30:00+00:00"),  # 学校时区 11-02 00:30,本周
        (-1, "2026-11-02T01:00:00+00:00"),
    ):
        db.add(
            Review(
                op_id=uuid4(),
                enrollment_id=e,
                class_id=UUID(CLASS_ID),
                category="individual",
                reason_text="测试",
                score_delta=delta,
                given_by_user_id=UUID(TEACHER_USER_ID),
                given_at=datetime.fromisoformat(at),
            )
        )
    db.flush()
    body = client.get(f"{BASE}/summary", headers=auth(settings)).json()
    assert body["week_start"] == "2026-11-02"
    assert len(body["items"]) == 10
    row = next(i for i in body["items"] if i["enrollment_id"] == str(e))
    assert row == {
        "enrollment_id": str(e),
        "total": 4,
        "week": 2,
        "plus_count": 2,
        "minus_count": 1,
    }


def test_revoke_own_op_is_audited_once(client, db, settings):
    op = uuid4()
    client.post(
        BASE, json=individual([enrollment_of(db, STUDENT_IDS[0])], op_id=op), headers=auth(settings)
    )
    first = client.post(f"{BASE}/{op}/revoke", headers=auth(settings)).json()
    again = client.post(f"{BASE}/{op}/revoke", headers=auth(settings)).json()
    assert (first["revoked"], again["revoked"]) == (1, 0)
    assert [(r.action, r.success) for r in audit_rows(db, op)] == [("review.revoke", True)]


def test_revoke_others_forbidden_and_audited(client, db, settings):
    op = uuid4()
    client.post(
        BASE,
        json=individual([enrollment_of(db, STUDENT_IDS[0])], op_id=op),
        headers=auth(settings, SUBJECT_USER_ID),
    )
    res = client.post(f"{BASE}/{op}/revoke", headers=auth(settings))
    assert res.status_code == 403
    assert [(r.action, r.success) for r in audit_rows(db, op)] == [("review.revoke", False)]


def test_empty_cursor_is_first_page(client, db, settings):
    client.post(BASE, json=individual([enrollment_of(db, STUDENT_IDS[0])]), headers=auth(settings))
    res = client.get(BASE, params={"cursor": ""}, headers=auth(settings))
    assert res.status_code == 200
    assert len(res.json()["items"]) == 1


def test_replay_after_revoke_does_not_resurrect(client, db, settings):
    payload = individual([enrollment_of(db, STUDENT_IDS[0])])
    assert client.post(BASE, json=payload, headers=auth(settings)).status_code == 201
    client.post(f"{BASE}/{payload['op_id']}/revoke", headers=auth(settings))
    again = client.post(BASE, json=payload, headers=auth(settings))
    assert (again.status_code, again.json()["items"]) == (200, [])
    assert review_count(db) == 1
    other = client.post(BASE, json=payload, headers=auth(settings, SUBJECT_USER_ID))
    assert other.status_code == 409


def test_list_filtered_by_enrollment(client, db, settings):
    e1 = enrollment_of(db, STUDENT_IDS[0])
    e2 = enrollment_of(db, STUDENT_IDS[1])
    client.post(BASE, json=individual([e1], reason="第一条"), headers=auth(settings))
    client.post(BASE, json=individual([e1], reason="第二条"), headers=auth(settings))
    client.post(BASE, json=individual([e2], reason="别人"), headers=auth(settings))
    body = client.get(f"{BASE}?enrollment_id={e1}", headers=auth(settings)).json()
    assert len(body["items"]) == 2
    assert {i["enrollment_id"] for i in body["items"]} == {str(e1)}
    limited = client.get(f"{BASE}?enrollment_id={e1}&limit=1", headers=auth(settings)).json()
    assert len(limited["items"]) == 1 and limited["next_cursor"] is not None
    assert len(client.get(f"{BASE}?limit=40", headers=auth(settings)).json()["items"]) == 3
    # 已撤销的仍被排除
    rid = body["items"][0]["id"]
    client.post(f"{BASE}/items/{rid}/revoke", headers=auth(settings))
    after = client.get(f"{BASE}?enrollment_id={e1}", headers=auth(settings)).json()
    assert len(after["items"]) == 1


def test_revoke_single_item_keeps_rest_of_op(client, db, settings):
    op = uuid4()
    res = client.post(BASE, json=whole_class(op), headers=auth(settings))
    assert len(res.json()["items"]) == 10
    target = enrollment_of(db, STUDENT_IDS[0])
    rid = next(i["id"] for i in res.json()["items"] if i["enrollment_id"] == str(target))
    first = client.post(f"{BASE}/items/{rid}/revoke", headers=auth(settings))
    assert first.status_code == 200
    assert first.json() == {"review_id": rid, "revoked": 1}
    items = client.get(f"{BASE}/summary", headers=auth(settings)).json()["items"]
    totals = {i["enrollment_id"]: i["total"] for i in items}
    assert totals.pop(str(target)) == 0
    assert len(totals) == 9 and set(totals.values()) == {1}
    again = client.post(f"{BASE}/items/{rid}/revoke", headers=auth(settings))
    assert again.status_code == 200
    assert again.json() == {"review_id": rid, "revoked": 0}
    assert [(r.action, r.success, r.object_type) for r in audit_rows(db, rid)] == [
        ("review.revoke", True, "review")
    ]


def test_revoke_item_by_other_teacher_denied(client, db, settings):
    res = client.post(
        BASE,
        json=individual([enrollment_of(db, STUDENT_IDS[0])]),
        headers=auth(settings),
    )
    rid = res.json()["items"][0]["id"]
    other = client.post(f"{BASE}/items/{rid}/revoke", headers=auth(settings, SUBJECT_USER_ID))
    assert other.status_code == 403
    assert [(r.action, r.success, r.object_type) for r in audit_rows(db, rid)] == [
        ("review.revoke", False, "review")
    ]
    assert len(client.get(BASE, headers=auth(settings)).json()["items"]) == 1


def test_revoke_item_wrong_class_404(client, db, settings):
    missing = client.post(f"{BASE}/items/{uuid4()}/revoke", headers=auth(settings))
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "NOT_FOUND")
    other_class = uuid4()
    res = client.post(
        f"/api/v1/classes/{other_class}/reviews/items/{uuid4()}/revoke", headers=auth(settings)
    )
    assert res.status_code == 404
