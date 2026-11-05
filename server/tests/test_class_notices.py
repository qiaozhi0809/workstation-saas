"""M4b 班主任班级公告:`/classes/{cid}/notices*`。使用种子里的虚构老师 / 家长。"""

from uuid import UUID, uuid4

from sqlalchemy import func, select, text

from app.models import Notice, NoticeRecipient
from tests.helpers import audit_rows, auth
from tests.test_notices import (
    C31,
    C32,
    INBOX,
    LI,
    PRINCIPAL,
    T01,
    T02,
    T03,
    T04,
    ZHOU,
    events,  # noqa: F401 - fixture
    recipients_of,
)

CHOICE = {"kind": "choice", "options": ["参加", "不参加"], "allow_note": True}


def url(cid=C32, tail="") -> str:
    return f"/api/v1/classes/{cid}/notices{tail}"


def post(client, settings, who, cid=C32, **extra):
    body = {"title": "家长会", "content": "周五下午三点开家长会", **extra}
    return client.post(url(cid), json=body, headers=auth(settings, who))


def count_notices(db) -> int:
    return db.scalar(select(func.count()).select_from(Notice)) or 0


def test_homeroom_sends_to_class_parents(client, db, settings, events):  # noqa: F811
    res = post(client, settings, T01, ack=CHOICE)
    assert res.status_code == 201, res.text
    notice = res.json()
    assert notice["audience"] == "parents" and notice["target_label"] == "三年二班家长"
    assert notice["ack"] == CHOICE
    assert recipients_of(db, notice["id"]) == {LI, T04}  # 不含次要家长、不含发送人
    assert notice["recipients"] == 2 and notice["students_without_parent"] == 8
    row = db.get(Notice, UUID(notice["id"]))
    assert row.class_id == UUID(C32) and row.from_user_id == UUID(T01)

    [sent] = [r for r in audit_rows(db, notice["id"]) if r.action == "notice.send"]
    assert sent.success and sent.extra["audience"] == "parents" and sent.extra["ack"] == "choice"

    pushed = [m for m in events() if m["event"]["type"] == "notice.new"]
    assert len(pushed) == 1 and set(pushed[0]["user_ids"]) == {LI, T04}
    item = client.get(INBOX, headers=auth(settings, LI)).json()["items"][0]
    assert item["id"] == notice["id"] and item["students"] == ["王小一"] and item["can_ack"] is True


def test_class_notice_scope(client, db, settings):
    cases = [(T01, C31), (T02, C32), (T03, C32), (T04, C32)]  # 别班班主任 / 副班主任 / 任课
    for who, cid in cases:
        res = post(client, settings, who, cid)
        assert res.status_code == 403, (who, cid)
        denied = [r for r in audit_rows(db, cid) if r.action == "class.notice" and not r.success]
        assert any(r.user_id == UUID(who) for r in denied), (who, cid)
    # 校长没有 class.notice
    assert post(client, settings, PRINCIPAL).status_code == 403
    assert count_notices(db) == 0

    # 不存在的班 404;停用的班(对班主任本人)404
    assert post(client, settings, T01, str(uuid4())).status_code == 404
    db.execute(text("UPDATE classes SET active = false WHERE id = :c"), {"c": C32})
    assert post(client, settings, T01).status_code == 404
    assert count_notices(db) == 0


def test_class_notice_validation(client, db, settings):
    assert post(client, settings, T01, title="  ").status_code == 400
    assert post(client, settings, T01, ack={"kind": "bogus"}).status_code == 400
    assert post(client, settings, T01, ack_deadline="2000-01-01T00:00:00+08:00").status_code == 400
    assert count_notices(db) == 0


def test_class_list_and_recall(client, db, settings, events):  # noqa: F811
    mine = post(client, settings, T01, ack=CHOICE).json()
    # 同一老师发给全校家长的、别人发的,都不在本班列表里
    other = client.post(
        "/api/v1/admin/notices",
        json={
            "title": "x",
            "content": "y",
            "target": {"kind": "class", "class_id": C32},
            "audience": "parents",
        },
        headers=auth(settings, PRINCIPAL),
    ).json()
    h = auth(settings, T01)
    page = client.get(url(), headers=h).json()
    assert page["total"] == 1 and [i["id"] for i in page["items"]] == [mine["id"]]
    assert client.get(url(), params={"page": 0}, headers=h).status_code == 400
    assert client.get(url(), params={"page": 1001}, headers=h).status_code == 400
    second = post(client, settings, T01).json()
    ids = [i["id"] for i in client.get(url(), headers=h).json()["items"]]
    assert ids == [second["id"], mine["id"]]  # 时间倒序

    # 撤回别人的 / 别的班的 404
    assert client.post(url(tail=f"/{other['id']}/recall"), headers=h).status_code == 404
    assert (
        client.post(url(C31, f"/{mine['id']}/recall"), headers=auth(settings, T04)).status_code
        == 404
    )
    assert (
        client.post(url(tail=f"/{mine['id']}/recall"), headers=auth(settings, T02)).status_code
        == 403
    )
    events()  # 清空
    res = client.post(url(tail=f"/{mine['id']}/recall"), headers=h)
    assert res.status_code == 200 and res.json()["recalled_at"] is not None
    pushed = [m for m in events() if m["event"]["type"] == "notice.recalled"]
    assert len(pushed) == 1 and set(pushed[0]["user_ids"]) == {LI, T04}
    assert [r.action for r in audit_rows(db, mine["id"]) if r.action == "notice.recall"] == [
        "notice.recall"
    ]
    item = {i["id"]: i for i in client.get(INBOX, headers=auth(settings, LI)).json()["items"]}[
        mine["id"]
    ]
    assert item["recalled"] is True and item["can_ack"] is False
    assert (
        db.scalar(
            select(func.count())
            .select_from(NoticeRecipient)
            .where(NoticeRecipient.notice_id == UUID(mine["id"]))
        )
        == 2
    )


def test_parent_token_denied_on_class_notices(client, db, settings):
    n = post(client, settings, T01).json()["id"]
    before = count_notices(db)
    for who in (LI, ZHOU):
        h = auth(settings, who)
        assert client.get(url(), headers=h).status_code == 403
        res = client.post(url(), json={"title": "a", "content": "b"}, headers=h)
        assert res.status_code == 403
        assert client.post(url(tail=f"/{n}/recall"), headers=h).status_code == 403
        denied = [
            r for r in audit_rows(db, C32) if r.user_id == UUID(who) and r.action == "class.notice"
        ]
        assert len(denied) == 3 and not any(r.success for r in denied)
    assert count_notices(db) == before
    assert db.get(Notice, UUID(n)).recalled_at is None
