import json
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text

from app.models import AcademicYear, Notice, NoticeRecipient, Parent, ParentLink, User
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


def body(target, title="放假通知", content="下周一放假一天", **extra):
    return {"title": title, "content": content, "target": target, **extra}


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

    # L46:曾有过教师 / 管理岗绑定、现已失效的本校账号 → 409;从未有过的 / 不存在的 / 自己 → 403
    for who in (PRINCIPAL, DEAN):
        for gone in (null_year, other_year, ended, frozen):
            res = send(client, settings, who, {"kind": "users", "user_ids": [T01, str(gone.id)]})
            assert res.status_code == 409, (who, gone.login_name)
            assert res.json()["error"]["code"] == "RECIPIENT_UNAVAILABLE"
            assert res.json()["error"]["details"] == {"user_ids": [str(gone.id)]}
        for bad in (str(nobody.id), str(uuid4()), who):
            res = send(client, settings, who, {"kind": "users", "user_ids": [T01, bad]})
            assert res.status_code == 403, (who, bad)
        # 混有越权的人时按越权处理,不泄露谁已失效
        mixed = {"kind": "users", "user_ids": [str(frozen.id), str(nobody.id)]}
        assert send(client, settings, who, mixed).status_code == 403
    count = db.scalar(select(func.count()).select_from(Notice))
    assert count == 0


def test_users_target_frozen_teacher_with_parent_account_403(client, db, settings):
    # 已冻结的前教师 + 纯家长账号:整体 403,不是 409(不能借此探出哪些账号是家长)
    frozen = make_teacher_account(db, login_name="mix_frozen")
    bind(db, frozen.id, Role.subject_teacher, class_id=C32)
    frozen.status = "frozen"
    db.flush()
    for who in (PRINCIPAL, DEAN):
        for parent in (LI, ZHOU):
            target = {"kind": "users", "user_ids": [str(frozen.id), parent]}
            assert send(client, settings, who, target).status_code == 403, (who, parent)
        only = {"kind": "users", "user_ids": [str(frozen.id)]}
        assert send(client, settings, who, only).status_code == 409
    assert db.scalar(select(func.count()).select_from(Notice)) == 0


def _denied_count(db, who) -> int:
    return len(
        db.scalars(
            select(AuditLog).where(
                AuditLog.user_id == UUID(who),
                AuditLog.action == "notice.send",
                AuditLog.success.is_(False),
            )
        ).all()
    )


def test_grade_head_unavailable_409_only_for_own_grade_frozen(client, db, settings):
    # A-1:409 不得泄露范围外账号状态;年级组长只对"本年级当前绑定但已冻结"的人返回 409
    gh = GRADE_HEAD3
    own = make_teacher_account(db, login_name="gh_own_frozen")
    bind(db, own.id, Role.subject_teacher, class_id=C32)
    own.status = "frozen"
    other = make_teacher_account(db, login_name="gh_other_frozen")
    bind(db, other.id, Role.subject_teacher, class_id=C41)
    other.status = "frozen"
    unbound = make_teacher_account(db, login_name="gh_unbound")
    bind(db, unbound.id, Role.subject_teacher, class_id=C32, ended=True)
    unbound_frozen = make_teacher_account(db, login_name="gh_unbound_frozen")
    bind(db, unbound_frozen.id, Role.subject_teacher, class_id=C32, ended=True)
    unbound_frozen.status = "frozen"
    db.flush()

    res = send(client, settings, gh, {"kind": "users", "user_ids": [T01, str(own.id)]})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "RECIPIENT_UNAVAILABLE"
    assert res.json()["error"]["details"] == {"user_ids": [str(own.id)]}
    assert _denied_count(db, gh) == 0

    before = _denied_count(db, gh)
    for bad in (other, unbound, unbound_frozen):
        res = send(client, settings, gh, {"kind": "users", "user_ids": [T01, str(bad.id)]})
        assert res.status_code == 403, bad.login_name
        assert "user_ids" not in json.dumps(res.json())
    for bad in (LI, ZHOU):
        res = send(client, settings, gh, {"kind": "users", "user_ids": [bad]})
        assert res.status_code == 403
    assert _denied_count(db, gh) == before + 5
    # 混合:本年级冻结 + 范围外冻结 → 整体 403
    mixed = {"kind": "users", "user_ids": [str(own.id), str(other.id)]}
    res = send(client, settings, gh, mixed)
    assert res.status_code == 403 and "user_ids" not in json.dumps(res.json())


def test_principal_still_409_for_frozen_former_teacher(client, db, settings):
    frozen = make_teacher_account(db, login_name="pr_frozen")
    bind(db, frozen.id, Role.subject_teacher, class_id=C41, ended=True)
    frozen.status = "frozen"
    db.flush()
    res = send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": [str(frozen.id)]})
    assert res.status_code == 409
    assert res.json()["error"]["details"] == {"user_ids": [str(frozen.id)]}


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


# ---- M4b:通知到家长、L44 / L46 / L47 ----

LI = "55555555-5555-5555-5555-555555555561"  # 李家长:S0001(三年二班)、S0017(四年一班)主家长
ZHOU = "55555555-5555-5555-5555-555555555562"  # 周家长:S0001 次要家长
TARGET_C32 = {"kind": "class", "class_id": C32}
CONFIRM = {"kind": "confirm"}


def send_parents(client, settings, who, target, **kw):
    return send(client, settings, who, target, audience="parents", **kw)


def set_link(db, login: str, mk: str, **cols) -> None:
    """改种子家长绑定;只读状态必须带 readonly_since(表约束)。"""
    allowed = {"status", "readonly_since", "ended_at", "notify_enabled", "is_primary"}
    assert set(cols) <= allowed
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    db.execute(
        text(
            f"UPDATE parent_links SET {sets} WHERE id = ("  # noqa: S608 - 列名来自白名单
            " SELECT pl.id FROM parent_links pl JOIN parents p ON p.id = pl.parent_id"
            " JOIN users u ON u.id = p.user_id JOIN students s ON s.id = pl.student_id"
            " WHERE u.login_name = :login AND s.mk = :mk)"
        ),
        {**cols, "login": login, "mk": mk},
    )


def make_readonly(db, login: str, mk: str) -> None:
    set_link(db, login, mk, status="readonly", readonly_since=datetime.now(UTC))


def student_rows(db, notice_id) -> set[tuple[str, str]]:
    return {
        (mk, str(parent))
        for mk, parent in db.execute(
            text(
                "SELECT s.mk, ns.parent_user_id FROM notice_students ns"
                " JOIN students s ON s.id = ns.student_id WHERE ns.notice_id = :n"
            ),
            {"n": notice_id},
        )
    }


def test_parent_recipients_primary_active_only(client, db, settings):
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32)
    assert res.status_code == 201, res.text
    notice = res.json()
    assert notice["audience"] == "parents" and notice["target_label"] == "三年二班家长"
    assert notice["ack"] == {"kind": "none"} and notice["ack_deadline"] is None
    assert recipients_of(db, notice["id"]) == {LI, T04}  # 不含次要家长 ZHOU、不含发送人
    assert notice["recipients"] == 2
    assert notice["students_without_parent"] == 8 and notice["acked"] == 0
    assert student_rows(db, notice["id"]) == {("S0001", LI), ("S0002", T04)}

    make_readonly(db, "13800000061", "S0001")
    again = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert recipients_of(db, again["id"]) == {T04}
    assert again["students_without_parent"] == 9
    assert student_rows(db, again["id"]) == {("S0002", T04)}


def test_parent_recipients_ended_link_inactive_enrollment_and_class_skipped(client, db, settings):
    set_link(db, "13800000061", "S0001", status="ended", ended_at=datetime.now(UTC))
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert recipients_of(db, res["id"]) == {T04}

    set_link(db, "13800000061", "S0001", status="active", ended_at=None)
    db.execute(
        text(
            "UPDATE enrollments SET status = 'removed' WHERE student_id ="
            " (SELECT id FROM students WHERE mk = 'S0002')"
        )
    )
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert recipients_of(db, res["id"]) == {LI}
    assert res["students_without_parent"] == 8  # S0002 不在读,不算

    db.execute(text("UPDATE classes SET active = false WHERE id = :c"), {"c": C32})
    res = send_parents(client, settings, PRINCIPAL, TARGET_SCHOOL).json()
    assert recipients_of(db, res["id"]) == {LI}
    assert student_rows(db, res["id"]) == {("S0017", LI)}  # 停用班的学生不算


def test_two_children_one_notice(client, db, settings):
    res = send_parents(client, settings, PRINCIPAL, TARGET_SCHOOL, ack=CONFIRM)
    assert res.status_code == 201, res.text
    nid = res.json()["id"]
    assert res.json()["target_label"] == "全校家长"
    assert recipients_of(db, nid) == {LI, T04}  # 李家长只有一条收件行
    assert student_rows(db, nid) == {("S0001", LI), ("S0017", LI), ("S0002", T04)}
    h = auth(settings, LI)
    item = inbox(client, settings, LI)["items"][0]
    assert item["students"] == ["魏小七", "王小一"]  # 按学号
    ack = client.post(f"{INBOX}/{nid}/ack", json={"choice": None, "note": None}, headers=h)
    assert ack.status_code == 204
    stats = client.get(f"{INBOX}/{nid}/acks", headers=auth(settings, PRINCIPAL)).json()
    mine = [r for r in stats["rows"] if r["user_id"] == LI]
    assert len(mine) == 2 and all(r["acked_at"] is not None for r in mine)
    other = [r for r in stats["rows"] if r["user_id"] == T04]
    assert len(other) == 1 and other[0]["acked_at"] is None


def test_notify_disabled_and_inactive_account_skipped(client, db, settings):
    set_link(db, "13800000061", "S0001", notify_enabled=False)
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert recipients_of(db, res["id"]) == {T04}
    assert res["students_without_parent"] == 9

    set_link(db, "13800000061", "S0001", notify_enabled=True)
    db.execute(text("UPDATE users SET status = 'frozen' WHERE id = :u"), {"u": LI})
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert recipients_of(db, res["id"]) == {T04}
    assert res["students_without_parent"] == 9


def test_dual_role_teacher_parent(client, db, settings):
    p = send_parents(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM).json()
    t = send(client, settings, PRINCIPAL, TARGET_SCHOOL, ack=CONFIRM).json()
    items = {i["id"]: i for i in inbox(client, settings, T04)["items"]}
    assert items[p["id"]]["students"] == ["李小二"] and items[p["id"]]["can_ack"] is True
    assert items[t["id"]]["students"] == [] and items[t["id"]]["can_ack"] is True
    h = auth(settings, T04)
    ack = {"choice": None, "note": None}
    assert client.post(f"{INBOX}/{p['id']}/ack", json=ack, headers=h).status_code == 204

    # 老师对象的通知不查绑定:孩子绑定变只读也能回执
    make_readonly(db, "teacher04", "S0002")
    assert client.post(f"{INBOX}/{t['id']}/ack", json=ack, headers=h).status_code == 204
    # 家长对象的通知:涉及的孩子绑定都不在用 → 403
    p2 = send_parents(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM)
    assert p2.status_code == 201  # 只读绑定不收新通知 → 收件人只剩 LI
    assert T04 not in recipients_of(db, p2.json()["id"])
    # 已收到的旧通知,绑定变只读后回执 403
    res = client.post(f"{INBOX}/{p['id']}/ack", json=ack, headers=h)
    assert res.status_code == 403 and res.json()["error"]["code"] == "ACK_NOT_ALLOWED"
    rows = [r for r in audit_rows(db, p["id"]) if r.action == "notice.ack"]
    assert [r.success for r in rows] == [True, False]
    inbox_item = {i["id"]: i for i in inbox(client, settings, T04)["items"]}[p["id"]]
    assert inbox_item["can_ack"] is False


def test_sender_is_parent_skips_own_child(client, db, settings):
    sender = db.get(User, UUID(PRINCIPAL))
    parent = Parent(user_id=sender.id, name="何校长")
    db.add(parent)
    db.flush()
    sid = db.scalar(text("SELECT id FROM students WHERE mk = 'S0003'"))
    db.add(ParentLink(parent_id=parent.id, student_id=sid, is_primary=True))
    db.flush()
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32).json()
    assert student_rows(db, res["id"]) == {("S0001", LI), ("S0002", T04)}
    assert res["students_without_parent"] == 7  # S0003 既不写 notice_students 也不计入
    assert PRINCIPAL not in recipients_of(db, res["id"])


def test_grade_head_parent_scope(client, db, settings):
    gh = GRADE_HEAD3
    assert send_parents(client, settings, gh, TARGET_SCHOOL).status_code == 403
    assert send_parents(client, settings, gh, {"kind": "class", "class_id": C41}).status_code == 403
    assert send_parents(client, settings, gh, {"kind": "grade", "grade_id": G4}).status_code == 403
    ok = send_parents(client, settings, gh, {"kind": "grade", "grade_id": GRADE_ID})
    assert ok.status_code == 201, ok.text
    assert ok.json()["target_label"] == "三年级家长"
    assert recipients_of(db, ok.json()["id"]) == {LI, T04}
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(gh),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) == 3
    users = {"kind": "users", "user_ids": [T01]}
    res = send_parents(client, settings, PRINCIPAL, users)
    assert res.status_code == 400 and res.json()["error"]["code"] == "TARGET_INVALID"


def test_unavailable_recipient_409(client, db, settings, events):
    db.get(User, UUID(T05)).status = "frozen"
    db.flush()
    res = send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": [T01, T05]})
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["code"] == "RECIPIENT_UNAVAILABLE"
    assert err["details"] == {"user_ids": [T05]}
    assert "1" in err["message"] and "重发" in err["message"]
    assert db.scalar(select(func.count()).select_from(Notice)) == 0
    assert events() == []
    # 去掉后重发成功
    assert (
        send(client, settings, PRINCIPAL, {"kind": "users", "user_ids": [T01]}).status_code == 201
    )


def test_users_target_parent_account_403(client, db, settings):
    for target in ({"kind": "users", "user_ids": [T01, LI]}, {"kind": "users", "user_ids": [ZHOU]}):
        res = send(client, settings, PRINCIPAL, target)
        assert res.status_code == 403, target
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(PRINCIPAL),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) == 2
    for who in (PRINCIPAL, GRADE_HEAD3):
        got = client.get(PEOPLE, params={"q": "李家长"}, headers=auth(settings, who))
        assert got.status_code == 200 and got.json() == []
    got = client.get(PEOPLE, params={"q": "13800000061"}, headers=auth(settings, PRINCIPAL))
    assert got.json() == []


def test_teacher_audience_excludes_parent_only_accounts(client, db, settings):
    res = send(client, settings, PRINCIPAL, TARGET_SCHOOL)
    got = recipients_of(db, res.json()["id"])
    assert T04 in got and LI not in got and ZHOU not in got
    assert res.json()["audience"] == "teachers"


def test_parent_token_denied_on_sender_endpoints(client, db, settings):
    h = auth(settings, LI)
    sent = send_parents(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM).json()
    nid = sent["id"]
    before = db.scalar(select(func.count()).select_from(Notice))
    assert client.get(ADMIN, headers=h).status_code == 403
    assert client.post(ADMIN, json=body(TARGET_SCHOOL), headers=h).status_code == 403
    assert (
        client.post(ADMIN, json=body(TARGET_C32, audience="parents"), headers=h).status_code == 403
    )
    assert client.get(f"{ADMIN}/options", headers=h).status_code == 403
    assert client.get(PEOPLE, headers=h).status_code == 403
    assert client.get(f"{ADMIN}/{nid}/recipients", headers=h).status_code == 403
    assert client.post(f"{ADMIN}/{nid}/recall", headers=h).status_code == 403
    assert client.get(f"{INBOX}/{nid}/acks", headers=h).status_code == 404
    assert client.get(f"{INBOX}/{nid}/acks/export", headers=h).status_code == 404
    assert db.scalar(select(func.count()).select_from(Notice)) == before
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(LI),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) == 7


def test_ack_other_parents_notice_404(client, db, settings):
    nid = send_parents(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM).json()["id"]
    assert LI in recipients_of(db, nid) and ZHOU not in recipients_of(db, nid)
    h = auth(settings, ZHOU)
    ack = {"choice": None, "note": None}
    assert client.post(f"{INBOX}/{nid}/ack", json=ack, headers=h).status_code == 404
    assert client.post(f"{INBOX}/{nid}/read", headers=h).status_code == 404
    row = db.get(NoticeRecipient, (UUID(nid), UUID(LI)))
    assert row.acked_at is None and row.read_at is None


def test_send_options(client, db, settings):
    res = client.get(f"{ADMIN}/options", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200, res.text
    opts = res.json()
    assert opts["school_wide"] is True
    assert [g["id"] for g in opts["grades"]] == [GRADE_ID, G4]
    assert [c["id"] for c in opts["classes"]] == [C31, C32, C41]
    assert {c["id"]: c["grade_id"] for c in opts["classes"]} == {
        C31: GRADE_ID,
        C32: GRADE_ID,
        C41: G4,
    }
    gh = client.get(f"{ADMIN}/options", headers=auth(settings, GRADE_HEAD3)).json()
    assert gh["school_wide"] is False
    assert [g["id"] for g in gh["grades"]] == [GRADE_ID]
    assert [c["id"] for c in gh["classes"]] == [C31, C32]
    assert client.get(f"{ADMIN}/options", headers=auth(settings, T01)).status_code == 403
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(T01),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) == 1


def test_page_and_q_caps(client, settings):
    h = auth(settings, PRINCIPAL)
    # 项目口径:查询参数校验失败统一 400 BAD_REQUEST(契约写 422,按代码)
    assert client.get(INBOX, params={"page": 1000}, headers=h).status_code == 200
    assert client.get(INBOX, params={"page": 1001}, headers=h).status_code == 400
    assert client.get(ADMIN, params={"page": 1001}, headers=h).status_code == 400
    assert client.get(PEOPLE, params={"q": "字" * 50}, headers=h).status_code == 200
    assert client.get(PEOPLE, params={"q": "字" * 51}, headers=h).status_code == 400


def test_parent_realtime(client, db, settings, events):
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32, title="家长会")
    nid = res.json()["id"]
    [msg] = events()
    assert set(msg["user_ids"]) == recipients_of(db, nid) == {LI, T04}
    assert ZHOU not in msg["user_ids"] and PRINCIPAL not in msg["user_ids"]
    assert msg["event"]["type"] == "notice.new" and msg["event"]["id"] == nid
    client.post(f"{ADMIN}/{nid}/recall", headers=auth(settings, PRINCIPAL))
    [recalled] = events()
    assert recalled["event"] == {"type": "notice.recalled", "id": nid}
    assert set(recalled["user_ids"]) == {LI, T04}


def test_send_audit_has_audience_and_ack(client, db, settings):
    ack = {"kind": "choice", "options": ["参加", "不参加"], "allow_note": True}
    res = send_parents(client, settings, PRINCIPAL, TARGET_C32, ack=ack)
    assert res.status_code == 201, res.text
    extra = audit_rows(db, res.json()["id"])[0].extra
    assert extra["audience"] == "parents"
    assert extra["ack"] == "choice"


def test_ack_spec_and_deadline_validation(client, db, settings):
    def go(**kw):
        return send_parents(client, settings, PRINCIPAL, TARGET_C32, **kw)

    bad_acks = [
        {"kind": "choice", "options": ["只有一个"], "allow_note": False},
        {"kind": "choice", "options": ["a", "b", "c", "d", "e", "f"], "allow_note": False},
        {"kind": "choice", "options": ["同", "同"], "allow_note": False},
        {"kind": "choice", "options": ["字" * 21, "b"], "allow_note": False},
        {"kind": "choice", "options": ["", "b"], "allow_note": False},
        {"kind": "bogus"},
    ]
    for ack in bad_acks:
        assert go(ack=ack).status_code == 400, ack
    past = "2000-01-01T00:00:00+00:00"
    assert go(ack=CONFIRM, ack_deadline=past).status_code == 400
    assert go(ack=CONFIRM, ack_deadline="2999-01-01T00:00:00").status_code == 400  # 无时区
    ok = go(ack=CONFIRM, ack_deadline="2999-01-01T00:00:00+00:00")
    assert ok.status_code == 201 and ok.json()["ack_deadline"].startswith("2999-01-01")
    row = db.get(Notice, UUID(ok.json()["id"]))
    assert row.require_ack is True and row.ack_kind == "confirm"
    assert db.scalar(select(func.count()).select_from(Notice)) == 1


def test_inbox_new_fields_for_teacher_notice(client, db, settings):
    ack = {"kind": "choice", "options": ["好", "否"], "allow_note": False}
    nid = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32}, ack=ack).json()[
        "id"
    ]
    item = inbox(client, settings, T01)["items"][0]
    assert item["id"] == nid and item["ack"] == ack and item["my_ack"] is None
    assert item["students"] == [] and item["can_ack"] is True and item["ack_deadline"] is None
    plain = send(client, settings, PRINCIPAL, {"kind": "class", "class_id": C32}).json()["id"]
    got = {i["id"]: i for i in inbox(client, settings, T01)["items"]}
    assert got[plain]["ack"] == {"kind": "none"} and got[plain]["can_ack"] is False


def test_unauthorized_sender_bad_deadline_is_403_not_400(client, db, settings):
    past = "2000-01-01T00:00:00+00:00"
    res = send_parents(client, settings, GRADE_HEAD3, TARGET_SCHOOL, ack=CONFIRM, ack_deadline=past)
    assert res.status_code == 403
    denied = db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(GRADE_HEAD3),
            AuditLog.action == "notice.send",
            AuditLog.success.is_(False),
        )
    ).all()
    assert len(denied) == 1
