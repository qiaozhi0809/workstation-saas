import json
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text

from app.models import AcademicYear, Notice, NoticeRecipient, User
from app.models.audit import AuditLog
from app.rbac.roles import Role
from app.ws.hub import CHANNEL
from tests.factories import bind, make_class, make_teacher_account
from tests.helpers import audit_rows, auth, freeze
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID

ADMIN = "/api/v1/admin/notices"
INBOX = "/api/v1/notices"
PEOPLE = f"{ADMIN}/people"

G4 = "33333333-3333-3333-3333-333333333334"
C31 = "44444444-4444-4444-4444-444444444441"  # 三年一班
C41 = "44444444-4444-4444-4444-444444444442"  # 四年一班
C32 = CLASS_ID  # 三年二班
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
T01 = "55555555-5555-5555-5555-555555555555"  # 三年二班班主任
T02 = "77777777-7777-7777-7777-777777777777"  # 三年二班副班主任
T03 = "88888888-8888-8888-8888-888888888888"  # 三年二班数学
T04 = "55555555-5555-5555-5555-555555555541"  # 三年一班班主任
T05 = "55555555-5555-5555-5555-555555555542"  # 四年一班班主任

TEACHERS = {T01, T02, T03, T04, T05}
ADMINS = {PRINCIPAL, DEAN, GRADE_HEAD3, IT_ADMIN}
GRADE3_TEACHERS = {T01, T02, T03, T04}
TARGET_SCHOOL = {"kind": "school"}


def body(target, title="放假通知", content="下周一放假一天"):
    return {"title": title, "content": content, "target": target}


def send(client, settings, who, target, **kw):
    return client.post(ADMIN, json=body(target, **kw), headers=auth(settings, who))


def recipients_of(db, notice_id) -> set[str]:
    return {
        str(u)
        for u in db.scalars(
            select(NoticeRecipient.user_id).where(NoticeRecipient.notice_id == UUID(notice_id))
        )
    }


def inbox(client, settings, who, page=1):
    res = client.get(INBOX, params={"page": page}, headers=auth(settings, who))
    assert res.status_code == 200, res.text
    return res.json()


def new_year(db) -> AcademicYear:
    year = AcademicYear(
        school_id=UUID(SCHOOL_ID),
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 7, 15),
        is_active=False,
    )
    db.add(year)
    db.flush()
    return year


@pytest.fixture
def events(redis_client):
    """订阅 ws:events,返回一个取出已发布消息的函数。"""
    pubsub = redis_client.pubsub()
    pubsub.subscribe(CHANNEL)
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"

    def drain() -> list[dict]:
        out = []
        while (item := pubsub.get_message(timeout=0.3)) is not None:
            if item["type"] == "message":
                out.append(json.loads(item["data"]))
        return out

    yield drain
    pubsub.close()


# ---- 发送与收件人 ----


def test_school_target_recipients(client, db, settings):
    res = send(client, settings, PRINCIPAL, TARGET_SCHOOL)
    assert res.status_code == 201, res.text
    notice = res.json()
    assert notice["target_label"] == "全校老师"
    assert notice["title"] == "放假通知" and notice["content"] == "下周一放假一天"
    assert notice["recalled_at"] is None and notice["read"] == 0
    expected = (TEACHERS | ADMINS) - {PRINCIPAL}
    assert recipients_of(db, notice["id"]) == expected
    assert notice["recipients"] == len(expected)
    row = db.get(Notice, UUID(notice["id"]))
    assert row.from_user_id == UUID(PRINCIPAL) and row.require_ack is False


def test_school_recipients_use_current_year_rules(client, db, settings):
    old = new_year(db)

    def teacher(label):
        return make_teacher_account(db, login_name=label)

    null_year = teacher("r_null_year")
    bind(db, null_year.id, Role.subject_teacher, class_id=C32, subject="美术", year_id=None)
    other_year = teacher("r_other_year")
    bind(db, other_year.id, Role.subject_teacher, class_id=C32, subject="美术", year_id=old.id)
    ended = teacher("r_ended")
    bind(db, ended.id, Role.subject_teacher, class_id=C32, subject="美术", ended=True)
    frozen = teacher("r_frozen")
    bind(db, frozen.id, Role.subject_teacher, class_id=C32, subject="美术")
    frozen.status = "frozen"
    admin_old = teacher("r_admin_other_year")
    bind(db, admin_old.id, Role.grade_head, grade_id=GRADE_ID, year_id=old.id)
    admin_ended = teacher("r_admin_ended")
    bind(db, admin_ended.id, Role.dean, school_id=SCHOOL_ID, year_id=None, ended=True)
    admin_null = teacher("r_admin_null_year")
    bind(db, admin_null.id, Role.dean, school_id=SCHOOL_ID, year_id=None)
    current = teacher("r_current")
    bind(db, current.id, Role.subject_teacher, class_id=C32, subject="美术")
    teacher("r_nobody")  # 没有任何绑定
    db.flush()

    res = send(client, settings, PRINCIPAL, TARGET_SCHOOL)
    assert res.status_code == 201, res.text
    got = recipients_of(db, res.json()["id"])
    assert got == (TEACHERS | ADMINS | {str(admin_null.id), str(current.id)}) - {PRINCIPAL}


def test_grade_and_class_target_recipients(client, db, settings):
    old = new_year(db)
    ghost = make_teacher_account(db, login_name="r_inactive_class")
    inactive = make_class(db, "三年九班")
    bind(db, ghost.id, Role.homeroom_teacher, class_id=inactive)
    db.execute(text("UPDATE classes SET active = false WHERE id = :i"), {"i": inactive})
    other_head = make_teacher_account(db, login_name="r_head4")
    bind(db, other_head.id, Role.grade_head, grade_id=G4)
    stale_head = make_teacher_account(db, login_name="r_head3_old")
    bind(db, stale_head.id, Role.grade_head, grade_id=GRADE_ID, year_id=old.id)
    db.flush()

    grade = send(client, settings, PRINCIPAL, {"kind": "grade", "grade_id": GRADE_ID})
    assert grade.status_code == 201, grade.text
    assert grade.json()["target_label"] == "三年级老师"
    assert recipients_of(db, grade.json()["id"]) == GRADE3_TEACHERS | {GRADE_HEAD3}

    cls = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32})
    assert cls.status_code == 201, cls.text
    assert cls.json()["target_label"] == "三年二班老师"
    assert recipients_of(db, cls.json()["id"]) == {T01, T02, T03}

    # 年级组长发本年级:收件人不含自己
    mine = send(client, settings, GRADE_HEAD3, {"kind": "grade", "grade_id": GRADE_ID})
    assert mine.status_code == 201
    assert recipients_of(db, mine.json()["id"]) == GRADE3_TEACHERS


def test_users_target(client, db, settings):
    res = send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": [T01, T05, T01]})
    assert res.status_code == 201, res.text
    assert res.json()["target_label"] == "指定 2 人"
    assert res.json()["recipients"] == 2
    assert recipients_of(db, res.json()["id"]) == {T01, T05}


def test_users_target_rejects_non_candidates(client, db, settings):
    old = new_year(db)
    null_year = make_teacher_account(db, login_name="u_null_year")
    bind(db, null_year.id, Role.subject_teacher, class_id=C32, year_id=None)
    other_year = make_teacher_account(db, login_name="u_other_year")
    bind(db, other_year.id, Role.subject_teacher, class_id=C32, year_id=old.id)
    ended = make_teacher_account(db, login_name="u_ended")
    bind(db, ended.id, Role.subject_teacher, class_id=C32, ended=True)
    frozen = make_teacher_account(db, login_name="u_frozen")
    bind(db, frozen.id, Role.subject_teacher, class_id=C32)
    frozen.status = "frozen"
    nobody = make_teacher_account(db, login_name="u_nobody")
    db.flush()

    for who in (PRINCIPAL, DEAN):
        for bad in (
            str(null_year.id),
            str(other_year.id),
            str(ended.id),
            str(frozen.id),
            str(nobody.id),
            str(uuid4()),
            who,  # 自己不在候选里
        ):
            res = send(client, settings, who, {"kind": "users", "user_ids": [T01, bad]})
            assert res.status_code == 403, (who, bad)
    count = db.scalar(select(func.count()).select_from(Notice))
    assert count == 0


def test_users_target_bounds(client, settings):
    res = send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": []})
    assert res.status_code == 400
    ids = [str(uuid4()) for _ in range(201)]
    res = send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": ids})
    assert res.status_code == 400


def test_grade_head_limits(client, db, settings):
    head4 = make_teacher_account(db, login_name="gh4")
    bind(db, head4.id, Role.grade_head, grade_id=G4)
    db.flush()
    gh = GRADE_HEAD3
    assert send(client, settings, gh, TARGET_SCHOOL).status_code == 403
    assert send(client, settings, gh, {"kind": "class", "class_id": C41}).status_code == 403
    assert send(client, settings, gh, {"kind": "grade", "grade_id": G4}).status_code == 403
    for bad in (T05, str(head4.id)):
        res = send(client, settings, gh, {"kind": "users", "user_ids": [T01, bad]})
        assert res.status_code == 403, bad
    assert send(client, settings, gh, {"kind": "class", "class_id": C31}).status_code == 201
    assert send(client, settings, gh, {"kind": "grade", "grade_id": GRADE_ID}).status_code == 201
    ok = send(client, settings, gh, {"kind": "users", "user_ids": [T01, T04]})
    assert ok.status_code == 201
    assert audit_rows(db, SCHOOL_ID)  # 拒绝审计落在 school 对象上
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(gh),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) >= 3


def test_missing_class_or_grade(client, settings):
    ghost = str(uuid4())
    assert (
        send(client, settings, PRINCIPAL, {"kind": "class", "class_id": ghost}).status_code == 404
    )
    assert (
        send(client, settings, PRINCIPAL, {"kind": "grade", "grade_id": ghost}).status_code == 404
    )
    assert (
        send(client, settings, GRADE_HEAD3, {"kind": "class", "class_id": ghost}).status_code == 403
    )
    assert (
        send(client, settings, GRADE_HEAD3, {"kind": "grade", "grade_id": ghost}).status_code == 403
    )


def test_non_senders_forbidden_and_audited(client, db, settings):
    for who in (T01, IT_ADMIN):
        res = send(client, settings, who, TARGET_SCHOOL)
        assert res.status_code == 403, who
        nid = str(uuid4())
        assert client.get(ADMIN, headers=auth(settings, who)).status_code == 403
        assert (
            client.get(f"{ADMIN}/{nid}/recipients", headers=auth(settings, who)).status_code == 403
        )
        assert client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, who)).status_code == 403
        assert client.get(PEOPLE, headers=auth(settings, who)).status_code == 403
        denied = db.scalars(
            select(AuditLog).where(
                AuditLog.user_id == UUID(who),
                AuditLog.action == "notice.send",
                AuditLog.success.is_(False),
            )
        ).all()
        assert len(denied) == 5
    assert db.scalar(select(func.count()).select_from(Notice)) == 0


def test_validation(client, settings):
    def post(**patch):
        return client.post(
            ADMIN, json=body(TARGET_SCHOOL) | patch, headers=auth(settings, PRINCIPAL)
        )

    for patch in (
        {"title": "   "},
        {"title": "字" * 51},
        {"content": ""},
        {"content": "字" * 2001},
        {"target": {"kind": "everyone"}},
        {"target": {"kind": "grade"}},
    ):
        res = post(**patch)
        assert res.status_code == 400, patch
        assert res.json()["error"]["code"] == "BAD_REQUEST"
    ok = post(title="  标题  ", content="  内容  ")
    assert ok.status_code == 201
    assert ok.json()["title"] == "标题" and ok.json()["content"] == "内容"
    assert post(title="字" * 50, content="字" * 2000).status_code == 201


def test_no_recipients(client, db, settings, events):
    empty = make_class(db, "三年八班")
    res = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": str(empty)})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "NO_RECIPIENTS"
    assert db.scalar(select(func.count()).select_from(Notice)) == 0
    assert (
        db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "notice.send")
        )
        == 0
    )
    assert events() == []


def test_send_audit(client, db, settings):
    res = send(client, settings, PRINCIPAL, {"kind": "grade", "grade_id": GRADE_ID})
    rows = audit_rows(db, res.json()["id"])
    assert [(r.action, r.success, r.user_id) for r in rows] == [
        ("notice.send", True, UUID(PRINCIPAL))
    ]
    extra = rows[0].extra
    assert extra["recipients"] == res.json()["recipients"]
    assert extra["target"]["kind"] == "grade"
    assert "下周一放假" not in json.dumps(extra, ensure_ascii=False)


def test_recipients_fixed_at_send(client, db, settings):
    res = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32})
    nid = res.json()["id"]
    late = make_teacher_account(db, login_name="late_teacher")
    bind(db, late.id, Role.subject_teacher, class_id=C32, subject="美术")
    db.flush()
    assert inbox(client, settings, str(late.id))["total"] == 0
    assert recipients_of(db, nid) == {T01, T02, T03}
    # 之后被冻结的人仍留在收件人表里
    db.get(User, UUID(T03)).status = "frozen"
    db.flush()
    assert recipients_of(db, nid) == {T01, T02, T03}


# ---- 收件箱 ----


def test_inbox_read_and_unread_count(client, db, settings, monkeypatch):
    freeze(monkeypatch, "2026-10-14T02:00:00+00:00")
    first = send(client, settings, PRINCIPAL, TARGET_SCHOOL, title="第一条").json()["id"]
    freeze(monkeypatch, "2026-10-14T03:00:00+00:00")
    second = send(
        client, settings, DEAN, {"kind": "class", "class_id": C32}, title="第二条"
    ).json()["id"]

    box = inbox(client, settings, T01)
    assert box["total"] == 2 and box["unread"] == 2
    assert [i["id"] for i in box["items"]] == [second, first]
    top = box["items"][0]
    assert top["title"] == "第二条" and top["content"] == "下周一放假一天"
    assert top["from_name"] == "冯主任" and top["read_at"] is None and top["recalled"] is False

    res = client.post(f"{INBOX}/{first}/read", headers=auth(settings, T01))
    assert res.status_code == 204 and res.content == b""
    box = inbox(client, settings, T01)
    assert box["unread"] == 1
    assert {i["id"]: i["read_at"] is not None for i in box["items"]} == {first: True, second: False}

    res = client.post(f"{INBOX}/read-all", headers=auth(settings, T01))
    assert res.status_code == 204
    assert inbox(client, settings, T01)["unread"] == 0
    # 别人的未读不受影响
    assert inbox(client, settings, T04)["unread"] == 1

    # 不是自己的通知 404(T04 没收到第二条)
    res = client.post(f"{INBOX}/{second}/read", headers=auth(settings, T04))
    assert res.status_code == 404
    assert client.post(f"{INBOX}/{uuid4()}/read", headers=auth(settings, T04)).status_code == 404


def test_read_twice_keeps_first_read_at(client, db, settings):
    nid = send(client, settings, PRINCIPAL, TARGET_SCHOOL).json()["id"]

    def read_at():
        return db.scalar(
            select(NoticeRecipient.read_at).where(
                NoticeRecipient.notice_id == UUID(nid), NoticeRecipient.user_id == UUID(T01)
            )
        )

    assert read_at() is None
    client.post(f"{INBOX}/{nid}/read", headers=auth(settings, T01))
    first = read_at()
    assert first is not None
    assert client.post(f"{INBOX}/{nid}/read", headers=auth(settings, T01)).status_code == 204
    assert read_at() == first
    client.post(f"{INBOX}/read-all", headers=auth(settings, T01))
    assert read_at() == first


def test_inbox_open_to_every_login(client, settings):
    send(client, settings, PRINCIPAL, TARGET_SCHOOL)
    for who in (T01, IT_ADMIN, GRADE_HEAD3, DEAN):
        assert inbox(client, settings, who)["total"] == 1
    assert inbox(client, settings, PRINCIPAL)["total"] == 0  # 发送人自己不收
    assert client.get(INBOX).status_code == 401


def test_inbox_paging(client, db, settings):
    for n in range(21):
        db.add(
            Notice(
                school_id=UUID(SCHOOL_ID),
                from_user_id=UUID(PRINCIPAL),
                title=f"n{n}",
                content="c",
                target={"kind": "school"},
                target_label="全校老师",
                created_at=datetime(2026, 10, 1, 0, n, tzinfo=UTC),
            )
        )
    db.flush()
    for notice in db.scalars(select(Notice)):
        db.add(NoticeRecipient(notice_id=notice.id, user_id=UUID(T01)))
    db.flush()
    page1 = inbox(client, settings, T01)
    assert page1["total"] == 21 and page1["unread"] == 21 and len(page1["items"]) == 20
    assert page1["items"][0]["title"] == "n20"
    page2 = inbox(client, settings, T01, page=2)
    assert [i["title"] for i in page2["items"]] == ["n0"]


# ---- 撤回与已读情况 ----


def test_recall_hides_content(client, db, settings, events):
    nid = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32}).json()["id"]
    client.post(f"{INBOX}/{nid}/read", headers=auth(settings, T01))
    events()  # 清掉发送时的消息

    res = client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["id"] == nid and out["recalled_at"] is not None
    assert out["recipients"] == 3 and out["read"] == 1

    box = inbox(client, settings, T02)
    [item] = box["items"]
    assert item["recalled"] is True and item["content"] is None
    assert item["title"] == "放假通知"
    assert box["unread"] == 0 and box["total"] == 1

    msgs = events()
    assert len(msgs) == 1
    assert msgs[0]["event"] == {"type": "notice.recalled", "id": nid}
    assert set(msgs[0]["user_ids"]) == {T01, T02, T03}
    assert [(r.action, r.success) for r in audit_rows(db, nid)] == [
        ("notice.send", True),
        ("notice.recall", True),
    ]


def test_recall_other_users_notice_404(client, settings, events):
    nid = send(client, settings, PRINCIPAL, TARGET_SCHOOL).json()["id"]
    events()
    res = client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, DEAN))
    assert res.status_code == 404
    assert client.post(f"{ADMIN}/{uuid4()}/recall", headers=auth(settings, DEAN)).status_code == 404
    assert events() == []


def test_recall_is_idempotent(client, db, settings, events):
    nid = send(client, settings, PRINCIPAL, TARGET_SCHOOL).json()["id"]
    events()
    first = client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL)).json()
    again = client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL))
    assert again.status_code == 200
    assert again.json()["recalled_at"] == first["recalled_at"]
    assert len(events()) == 1
    recalls = [r for r in audit_rows(db, nid) if r.action == "notice.recall"]
    assert len(recalls) == 1


def test_recipients_endpoint(client, db, settings, monkeypatch):
    nid = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32}).json()["id"]
    freeze(monkeypatch, "2026-10-14T02:00:00+00:00")
    client.post(f"{INBOX}/{nid}/read", headers=auth(settings, T03))
    freeze(monkeypatch, "2026-10-14T03:00:00+00:00")
    client.post(f"{INBOX}/{nid}/read", headers=auth(settings, T01))

    res = client.get(f"{ADMIN}/{nid}/recipients", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200, res.text
    out = res.json()
    assert [(r["user_id"], r["name"]) for r in out["read"]] == [(T03, "赵老师"), (T01, "张老师")]
    assert out["read"][0]["read_at"] < out["read"][1]["read_at"]
    assert out["unread"] == [{"user_id": T02, "name": "王老师"}]

    assert client.get(f"{ADMIN}/{nid}/recipients", headers=auth(settings, DEAN)).status_code == 404
    missing = f"{ADMIN}/{uuid4()}/recipients"
    assert client.get(missing, headers=auth(settings, PRINCIPAL)).status_code == 404


def test_sent_list(client, db, settings, monkeypatch):
    ids = []
    for n, who in enumerate([PRINCIPAL, DEAN, PRINCIPAL, PRINCIPAL]):
        freeze(monkeypatch, f"2026-10-14T0{n}:00:00+00:00")
        res = send(client, settings, who, {"kind": "class", "class_id": C32}, title=f"通知{n}")
        ids.append(res.json()["id"])
    client.post(f"{INBOX}/{ids[3]}/read", headers=auth(settings, T01))
    client.post(f"{ADMIN}/{ids[2]}/recall", headers=auth(settings, PRINCIPAL))

    res = client.get(ADMIN, headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200
    out = res.json()
    assert out["total"] == 3
    assert [i["id"] for i in out["items"]] == [ids[3], ids[2], ids[0]]
    assert out["items"][0]["read"] == 1 and out["items"][0]["recipients"] == 3
    assert out["items"][1]["recalled_at"] is not None
    assert client.get(ADMIN, headers=auth(settings, DEAN)).json()["total"] == 1


def test_sent_list_paging(client, db, settings):
    for n in range(21):
        db.add(
            Notice(
                school_id=UUID(SCHOOL_ID),
                from_user_id=UUID(PRINCIPAL),
                title=f"n{n}",
                content="c",
                target={"kind": "school"},
                target_label="全校老师",
                created_at=datetime(2026, 10, 1, 0, n, tzinfo=UTC),
            )
        )
    db.flush()
    page1 = client.get(ADMIN, headers=auth(settings, PRINCIPAL)).json()
    assert page1["total"] == 21 and len(page1["items"]) == 20
    assert page1["items"][0]["title"] == "n20"
    page2 = client.get(ADMIN, params={"page": 2}, headers=auth(settings, PRINCIPAL)).json()
    assert [i["title"] for i in page2["items"]] == ["n0"]
    assert page2["items"][0]["recipients"] == 0
    assert (
        client.get(ADMIN, params={"page": 0}, headers=auth(settings, PRINCIPAL)).status_code == 400
    )


# ---- 实时推送 ----


def test_send_publishes_after_commit(client, db, settings, events, monkeypatch):
    import app.domain.notices.service as svc

    calls: list[str] = []
    real_commit = db.commit
    real_publish = svc.publish

    def commit():
        calls.append("commit")
        return real_commit()

    def publish(redis, user_ids, event):
        calls.append(f"publish:{event['type']}")
        return real_publish(redis, user_ids, event)

    monkeypatch.setattr(db, "commit", commit)
    monkeypatch.setattr(svc, "publish", publish)

    res = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32})
    assert res.status_code == 201
    assert calls[-1] == "publish:notice.new"
    assert "commit" in calls[:-1]
    assert calls.count("publish:notice.new") == 1

    nid = res.json()["id"]
    calls.clear()
    assert (
        client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL)).status_code == 200
    )
    assert calls[-1] == "publish:notice.recalled" and "commit" in calls[:-1]

    # 发送失败(无收件人)不发布
    calls.clear()
    empty = make_class(db, "三年七班")
    assert (
        send(client, settings, PRINCIPAL, {"kind": "class", "class_id": str(empty)}).status_code
        == 400
    )
    assert not [c for c in calls if c.startswith("publish")]
    events()


def test_send_endpoints_are_sync(client):
    import inspect

    from app.domain.notices import router as r

    for fn in (r.send_notice, r.recall_notice):
        assert not inspect.iscoroutinefunction(fn)


def test_realtime_event_payload(client, db, settings, events):
    res = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32}, title="期中安排")
    nid = res.json()["id"]
    [msg] = events()
    assert set(msg["user_ids"]) == recipients_of(db, nid) == {T01, T02, T03}
    event = msg["event"]
    assert event["type"] == "notice.new" and event["id"] == nid
    assert event["title"] == "期中安排" and event["from_name"] == "何校长"
    assert isinstance(event["created_at"], str)
    datetime.fromisoformat(event["created_at"])
    assert set(event) == {"type", "id", "title", "from_name", "created_at"}

    # 撤回
    client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL))
    [recalled] = events()
    assert recalled["event"] == {"type": "notice.recalled", "id": nid}
    assert set(recalled["user_ids"]) == {T01, T02, T03}


def test_failed_send_publishes_nothing(client, db, settings, events):
    assert send(client, settings, T01, TARGET_SCHOOL).status_code == 403
    assert (
        send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": [str(uuid4())]}).status_code
        == 403
    )
    assert send(client, settings, PRINCIPAL, TARGET_SCHOOL, title="").status_code == 400
    assert send(client, settings, GRADE_HEAD3, TARGET_SCHOOL).status_code == 403
    empty = make_class(db, "三年六班")
    assert (
        send(client, settings, PRINCIPAL, {"kind": "class", "class_id": str(empty)}).status_code
        == 400
    )
    assert events() == []


# ---- 候选人 ----


def test_notice_people_scope(client, db, settings):
    frozen = make_teacher_account(db, login_name="p_frozen")
    bind(db, frozen.id, Role.subject_teacher, class_id=C32)
    frozen.status = "frozen"
    extra_head = make_teacher_account(db, login_name="p_head3")
    bind(db, extra_head.id, Role.grade_head, grade_id=GRADE_ID)
    head4 = make_teacher_account(db, login_name="p_head4")
    bind(db, head4.id, Role.grade_head, grade_id=G4)
    db.flush()

    def people(who, **params):
        res = client.get(PEOPLE, params=params, headers=auth(settings, who))
        assert res.status_code == 200, res.text
        return res.json()

    everyone = people(PRINCIPAL)
    ids = {p["user_id"] for p in everyone}
    assert {T01, DEAN, T05, GRADE_HEAD3, IT_ADMIN} <= ids
    assert PRINCIPAL not in ids and str(frozen.id) not in ids
    assert people(PRINCIPAL, q="teacher01") == [
        {"user_id": T01, "name": "张老师", "tags": ["三年二班班主任"]}
    ]
    assert {p["user_id"] for p in people(PRINCIPAL, q="冯")} == {DEAN}
    assert people(PRINCIPAL, q="p_frozen") == []

    scoped = {p["user_id"] for p in people(GRADE_HEAD3)}
    assert scoped == GRADE3_TEACHERS | {str(extra_head.id)}
    assert GRADE_HEAD3 not in scoped  # 不含自己
    assert not scoped & {T05, DEAN, PRINCIPAL, IT_ADMIN, str(head4.id)}

    # 候选与 users 目标同口径:候选里的人都能选,候选外的不能
    ok = send(client, settings, GRADE_HEAD3, {"kind": "users", "user_ids": sorted(scoped)})
    assert ok.status_code == 201, ok.text


def test_notice_people_tags_and_year_rules(client, db, settings):
    old = new_year(db)
    null_year = make_teacher_account(db, login_name="y_null")
    bind(db, null_year.id, Role.subject_teacher, class_id=C32, year_id=None)
    other_year = make_teacher_account(db, login_name="y_other")
    bind(db, other_year.id, Role.subject_teacher, class_id=C32, year_id=old.id)
    ended = make_teacher_account(db, login_name="y_ended")
    bind(db, ended.id, Role.subject_teacher, class_id=C32, ended=True)
    db.flush()

    res = client.get(PEOPLE, params={"q": "y_"}, headers=auth(settings, PRINCIPAL))
    assert res.json() == []
    by_id = {p["user_id"]: p for p in client.get(PEOPLE, headers=auth(settings, PRINCIPAL)).json()}
    assert by_id[T02]["tags"] == ["三年二班副班主任"]
    assert by_id[T03]["tags"] == ["数学"]
    assert by_id[T04]["tags"] == ["三年一班班主任"]
    assert by_id[GRADE_HEAD3]["tags"] == ["三年级组长"]
    assert by_id[DEAN]["tags"] == ["教导主任"]
    assert by_id[IT_ADMIN]["tags"] == ["信息中心"]


def test_notice_people_q_default_and_limit(client, db, settings):
    for n in range(25):
        u = make_teacher_account(db, login_name=f"many{n:02d}")
        u.display_name = f"批量{n:02d}"
        bind(db, u.id, Role.subject_teacher, class_id=C32, subject="美术")
    db.flush()
    h = auth(settings, PRINCIPAL)
    no_q = client.get(PEOPLE, headers=h)
    empty_q = client.get(PEOPLE, params={"q": ""}, headers=h)
    assert no_q.status_code == 200 and empty_q.status_code == 200
    assert no_q.json() == empty_q.json()
    assert len(no_q.json()) == 20
    names = [p["name"] for p in no_q.json()]
    assert names == sorted(names)
    assert len(client.get(PEOPLE, params={"q": "批量"}, headers=h).json()) == 20
    assert len(client.get(PEOPLE, params={"q": "批量2"}, headers=h).json()) == 5


def test_notice_people_escapes_like(client, settings):
    h = auth(settings, PRINCIPAL)
    assert client.get(PEOPLE, params={"q": "%"}, headers=h).json() == []
    assert client.get(PEOPLE, params={"q": "_"}, headers=h).json() == []
