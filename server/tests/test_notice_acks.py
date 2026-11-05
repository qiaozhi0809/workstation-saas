"""M4b 回执:提交规则、统计与导出。使用种子里的虚构家长 / 老师。"""

import csv
import io
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.models import Notice, NoticeRecipient
from app.models.audit import AuditLog
from tests.helpers import auth
from tests.test_notices import (
    C32,
    INBOX,
    LI,
    PRINCIPAL,
    T01,
    T04,
    TARGET_SCHOOL,
    ZHOU,
    make_readonly,
    send,
)

CHOICE = {"kind": "choice", "options": ["参加", "不参加"], "allow_note": True}
CHOICE_NO_NOTE = {"kind": "choice", "options": ["参加", "不参加"], "allow_note": False}
CONFIRM = {"kind": "confirm"}
TARGET_C32 = {"kind": "class", "class_id": C32}
BOM = "﻿"


def parent_notice(client, settings, ack, **kw) -> str:
    res = send(client, settings, PRINCIPAL, TARGET_C32, audience="parents", ack=ack, **kw)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def post_ack(client, settings, who, nid, choice=None, note=None):
    return client.post(
        f"{INBOX}/{nid}/ack", json={"choice": choice, "note": note}, headers=auth(settings, who)
    )


def code(res) -> str:
    return res.json()["error"]["code"]


def row_of(db, nid, who) -> NoticeRecipient:
    db.expire_all()
    return db.get(NoticeRecipient, (UUID(nid), UUID(who)))


def ack_audits(db, nid):
    return [
        r
        for r in db.scalars(select(AuditLog).where(AuditLog.object_id == str(nid))).all()
        if r.action == "notice.ack"
    ]


def test_ack_rules(client, db, settings):
    # 校验:confirm 不带选项 / 留言
    c = parent_notice(client, settings, CONFIRM)
    for bad in ({"choice": 0, "note": None}, {"choice": None, "note": "知道了"}):
        res = post_ack(client, settings, LI, c, **bad)
        assert res.status_code == 400 and code(res) == "ACK_INVALID", bad
    assert row_of(db, c, LI).acked_at is None
    assert post_ack(client, settings, LI, c).status_code == 204
    assert row_of(db, c, LI).read_at is not None  # 回执顺带补上已读

    # choice:越界 / 缺选 / 不允许留言却带留言 / 超长留言
    n = parent_notice(client, settings, CHOICE)
    for bad in (
        {"choice": 2, "note": None},
        {"choice": -1, "note": None},
        {"choice": None, "note": None},
        {"choice": 0, "note": "字" * 201},
    ):
        res = post_ack(client, settings, LI, n, **bad)
        assert res.status_code == 400 and code(res) == "ACK_INVALID", bad
    nn = parent_notice(client, settings, CHOICE_NO_NOTE)
    res = post_ack(client, settings, LI, nn, choice=0, note="我想说")
    assert res.status_code == 400 and code(res) == "ACK_INVALID"

    # 截止前回执两次,第二次覆盖;空白留言视为 null,首尾空格去掉
    assert post_ack(client, settings, LI, n, choice=0, note=" 会到 ").status_code == 204
    first = row_of(db, n, LI)
    assert (first.ack_choice, first.ack_content) == (0, "会到")
    first_at = first.acked_at
    assert post_ack(client, settings, LI, n, choice=1, note="   ").status_code == 204
    second = row_of(db, n, LI)
    assert (second.ack_choice, second.ack_content) == (1, None)
    assert second.acked_at >= first_at

    # 截止
    notice = db.get(Notice, UUID(n))
    notice.ack_deadline = datetime.now(UTC) - timedelta(minutes=1)
    db.flush()
    res = post_ack(client, settings, LI, n, choice=0)
    assert res.status_code == 409 and code(res) == "ACK_CLOSED"
    assert row_of(db, n, LI).ack_choice == 1

    # 撤回
    r = parent_notice(client, settings, CONFIRM)
    client.post(f"/api/v1/admin/notices/{r}/recall", headers=auth(settings, PRINCIPAL))
    res = post_ack(client, settings, LI, r)
    assert res.status_code == 409 and code(res) == "NOTICE_RECALLED"

    # 不需要回执
    none = send(client, settings, PRINCIPAL, TARGET_C32, audience="parents").json()["id"]
    res = post_ack(client, settings, LI, none)
    assert res.status_code == 409 and code(res) == "ACK_NOT_REQUIRED"

    # 不是收件人
    for outsider in (T01, ZHOU, PRINCIPAL):
        assert post_ack(client, settings, outsider, c).status_code == 404
    assert post_ack(client, settings, LI, "00000000-0000-0000-0000-000000000000").status_code == 404

    # 只读分支:孩子绑定不再在用
    p = parent_notice(client, settings, CONFIRM)
    make_readonly(db, "13800000061", "S0001")
    res = post_ack(client, settings, LI, p)
    assert res.status_code == 403 and code(res) == "ACK_NOT_ALLOWED"
    assert row_of(db, p, LI).acked_at is None
    failed = [r for r in ack_audits(db, p) if not r.success]
    assert len(failed) == 1 and failed[0].user_id == UUID(LI)
    item = {i["id"]: i for i in client.get(INBOX, headers=auth(settings, LI)).json()["items"]}[p]
    assert item["can_ack"] is False


def test_ack_success_audit_has_no_note_text(client, db, settings):
    n = parent_notice(client, settings, CHOICE)
    assert post_ack(client, settings, LI, n, choice=0, note="私密留言内容").status_code == 204
    [row] = ack_audits(db, n)
    assert row.success and row.user_id == UUID(LI)
    assert "私密留言内容" not in str(row.extra)


def test_inbox_my_ack_and_can_ack(client, db, settings):
    n = parent_notice(client, settings, CHOICE)
    item = client.get(INBOX, headers=auth(settings, LI)).json()["items"][0]
    assert item["id"] == n and item["ack"] == CHOICE and item["my_ack"] is None
    assert item["can_ack"] is True and item["students"] == ["王小一"]
    post_ack(client, settings, LI, n, choice=1, note="有事")
    item = client.get(INBOX, headers=auth(settings, LI)).json()["items"][0]
    assert item["my_ack"]["choice"] == 1 and item["my_ack"]["note"] == "有事"
    assert isinstance(item["my_ack"]["acked_at"], str)


def test_ack_stats_and_export(client, db, settings):
    n = parent_notice(client, settings, CHOICE)
    post_ack(client, settings, LI, n, choice=0, note="到")
    post_ack(client, settings, T04, n, choice=1, note="=SUM(1,1)")
    h = auth(settings, PRINCIPAL)
    stats = client.get(f"{INBOX}/{n}/acks", headers=h).json()
    assert stats["audience"] == "parents" and stats["ack"] == CHOICE
    assert stats["total"] == 2 and stats["read"] == 2 and stats["acked"] == 2
    assert stats["counts"] == [1, 1] and stats["students_without_parent"] == 8
    assert [(r["student_name"], r["class_name"], r["user_name"]) for r in stats["rows"]] == [
        ("王小一", "三年二班", "李家长"),
        ("李小二", "三年二班", "孙老师"),
    ]
    assert stats["rows"][0]["choice"] == 0 and stats["rows"][0]["note"] == "到"
    assert stats["rows"][0]["student_id"] is not None

    # 不是发送人:404(含老师、家长、收件人本人)
    for other in (T01, LI, ZHOU, T04):
        assert client.get(f"{INBOX}/{n}/acks", headers=auth(settings, other)).status_code == 404
        res = client.get(f"{INBOX}/{n}/acks/export", headers=auth(settings, other))
        assert res.status_code == 404

    res = client.get(f"{INBOX}/{n}/acks/export", headers=h)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    text = res.content.decode("utf-8")
    assert text.startswith(BOM)
    rows = list(csv.reader(io.StringIO(text[1:])))
    assert rows[0] == ["班级", "学号", "学生", "家长", "已读时间", "回执", "留言", "回执时间"]
    assert rows[1][:4] == ["三年二班", "2026001", "王小一", "李家长"]
    assert rows[1][5:7] == ["参加", "到"]
    assert rows[2][5] == "不参加" and rows[2][6] == "'=SUM(1,1)"  # 公式前缀转义
    assert len(rows) == 3
    exported = [
        r
        for r in db.scalars(select(AuditLog).where(AuditLog.object_id == n)).all()
        if r.action == "notice.ack_export"
    ]
    assert len(exported) == 1 and exported[0].success and exported[0].user_id == UUID(PRINCIPAL)


def test_ack_stats_teacher_audience(client, db, settings):
    res = send(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM)
    n = res.json()["id"]
    assert post_ack(client, settings, T01, n).status_code == 204
    h = auth(settings, PRINCIPAL)
    stats = client.get(f"{INBOX}/{n}/acks", headers=h).json()
    assert stats["audience"] == "teachers" and stats["counts"] == []
    assert stats["total"] == 3 and stats["read"] == 1 and stats["acked"] == 1
    assert stats["students_without_parent"] == 0
    assert all(r["student_id"] is None and r["class_name"] is None for r in stats["rows"])
    mine = [r for r in stats["rows"] if r["user_id"] == T01]
    assert len(mine) == 1 and mine[0]["acked_at"] is not None
    text = client.get(f"{INBOX}/{n}/acks/export", headers=h).content.decode("utf-8")
    rows = list(csv.reader(io.StringIO(text.removeprefix(BOM))))
    assert rows[0] == ["姓名", "已读时间", "回执", "留言", "回执时间"]
    assert len(rows) == 4
    assert any(r[2] == "已知晓" for r in rows[1:])


def test_ack_stats_no_ack_notice(client, db, settings):
    n = send(client, settings, PRINCIPAL, TARGET_SCHOOL).json()["id"]
    stats = client.get(f"{INBOX}/{n}/acks", headers=auth(settings, PRINCIPAL)).json()
    assert stats["ack"] == {"kind": "none"} and stats["acked"] == 0
