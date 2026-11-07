"""M4b 回执:提交规则、统计与导出。使用种子里的虚构家长 / 老师。"""

import csv
import io
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, text

from app.domain.years.service import apply
from app.domain.years.suggest import suggest
from app.models import Notice, NoticeRecipient
from app.models.audit import AuditLog
from tests.helpers import auth, freeze
from tests.seed_ids import SCHOOL_ID
from tests.test_notices import (
    C32,
    G4,
    GRADE_HEAD3,
    INBOX,
    LI,
    PRINCIPAL,
    T01,
    T04,
    TARGET_SCHOOL,
    ZHOU,
    inbox,
    make_readonly,
    send,
    set_link,
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


def test_ack_requires_primary_link(client, db, settings):
    """提交回执与收件箱 can_ack 同一口径:绑定在用但不是主家长 → 403 ACK_NOT_ALLOWED + 失败审计;
    改回主家长后能回执。"""
    p = parent_notice(client, settings, CONFIRM)
    set_link(db, "13800000061", "S0001", is_primary=False)
    assert _item(client, settings, LI, p)["ack_block_reason"] == "not_primary"
    res = post_ack(client, settings, LI, p)
    assert res.status_code == 403 and code(res) == "ACK_NOT_ALLOWED"
    assert row_of(db, p, LI).acked_at is None
    failed = [r for r in ack_audits(db, p) if not r.success]
    assert len(failed) == 1 and failed[0].user_id == UUID(LI)
    set_link(db, "13800000061", "S0001", is_primary=True)
    assert post_ack(client, settings, LI, p).status_code == 204
    assert row_of(db, p, LI).acked_at is not None


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
    assert item["can_ack"] is True
    assert item["students_detail"] == [{"name": "王小一", "class_name": "三年二班"}]
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


def test_export_escapes_formula_prefixes(client, db, settings):
    n = parent_notice(client, settings, CHOICE)
    notes = {LI: "+1", T04: "-1"}
    for who, note in notes.items():
        assert post_ack(client, settings, who, n, choice=0, note=note).status_code == 204
    h = auth(settings, PRINCIPAL)

    def exported() -> dict[str, str]:
        text = client.get(f"{INBOX}/{n}/acks/export", headers=h).content.decode("utf-8")
        rows = list(csv.reader(io.StringIO(text.removeprefix(BOM))))
        return {r[3]: r[6] for r in rows[1:]}

    assert exported() == {"李家长": "'+1", "孙老师": "'-1"}
    row_li = row_of(db, n, LI)
    for raw, expect in (("@cmd", "'@cmd"), ("\t制表", "'\t制表"), ("普通留言", "普通留言")):
        row_li.ack_content = raw
        db.flush()
        assert exported()["李家长"] == expect, raw


def _item(client, settings, who, nid) -> dict:
    return {i["id"]: i for i in inbox(client, settings, who)["items"]}[nid]


def _snapshot_rows(db, nid) -> set[tuple[str, str | None, str | None]]:
    return {
        (mk, str(cid) if cid else None, name)
        for mk, cid, name in db.execute(
            text(
                "SELECT s.mk, ns.class_id, ns.class_name FROM notice_students ns"
                " JOIN students s ON s.id = ns.student_id WHERE ns.notice_id = :n"
            ),
            {"n": nid},
        )
    }


def test_students_detail(client, db, settings):
    """L87 / L282:两处写入点都记下发送时刻的班;收件箱只给 students_detail,旧的 students 已删。"""
    n = parent_notice(client, settings, CONFIRM)
    assert _snapshot_rows(db, n) == {("S0001", C32, "三年二班"), ("S0002", C32, "三年二班")}
    item = _item(client, settings, LI, n)
    assert "students" not in item
    assert item["students_detail"] == [{"name": "王小一", "class_name": "三年二班"}]

    wide = send(client, settings, PRINCIPAL, TARGET_SCHOOL, audience="parents").json()["id"]
    item = _item(client, settings, LI, wide)
    assert item["students_detail"] == [
        {"name": "魏小七", "class_name": "四年一班"},
        {"name": "王小一", "class_name": "三年二班"},
    ]

    # 班主任的班级公告(第二个写入点)
    res = client.post(
        f"/api/v1/classes/{C32}/notices",
        json={"title": "家长会", "content": "周五开会", "ack": CONFIRM},
        headers=auth(settings, T01),
    )
    assert res.status_code == 201, res.text
    assert _snapshot_rows(db, res.json()["id"]) == {
        ("S0001", C32, "三年二班"),
        ("S0002", C32, "三年二班"),
    }
    assert _item(client, settings, T04, res.json()["id"])["students_detail"] == [
        {"name": "李小二", "class_name": "三年二班"}
    ]

    # 老师对象:两个列表都空
    t = send(client, settings, PRINCIPAL, TARGET_C32, ack=CONFIRM).json()["id"]
    item = _item(client, settings, T01, t)
    assert item["students_detail"] == []


def test_ack_block_reason(client, db, settings, monkeypatch):
    """L88:不能回执的原因由后端给;can_ack 为假时有原因,为真时 null;截止按服务器时间判。"""
    freeze(monkeypatch, "2026-10-14T02:00:00+00:00")
    # 可回执
    n = parent_notice(client, settings, CONFIRM, ack_deadline="2026-10-14T03:00:00+00:00")
    item = _item(client, settings, LI, n)
    assert item["can_ack"] is True and item["ack_block_reason"] is None
    # 已过截止(服务器时间)
    freeze(monkeypatch, "2026-10-14T03:00:00+00:00")
    item = _item(client, settings, LI, n)
    assert item["can_ack"] is False and item["ack_block_reason"] == "closed"
    # 撤回优先于截止
    client.post(f"/api/v1/admin/notices/{n}/recall", headers=auth(settings, PRINCIPAL))
    item = _item(client, settings, LI, n)
    assert item["can_ack"] is False and item["ack_block_reason"] == "recalled"

    # 不需要回执:can_ack 为假但没有"不能回执的原因"
    plain = send(client, settings, PRINCIPAL, TARGET_C32, audience="parents").json()["id"]
    item = _item(client, settings, LI, plain)
    assert item["can_ack"] is False and item["ack_block_reason"] is None

    # 不是主家长:绑定仍在用但 is_primary 为假
    p = parent_notice(client, settings, CONFIRM)
    set_link(db, "13800000061", "S0001", is_primary=False)
    item = _item(client, settings, LI, p)
    assert item["can_ack"] is False and item["ack_block_reason"] == "not_primary"
    # 绑定只读
    set_link(db, "13800000061", "S0001", is_primary=True)
    make_readonly(db, "13800000061", "S0001")
    item = _item(client, settings, LI, p)
    assert item["can_ack"] is False and item["ack_block_reason"] == "readonly"
    # 另一位家长(teacher04)不受影响
    item = _item(client, settings, T04, p)
    assert item["can_ack"] is True and item["ack_block_reason"] is None

    # 一人多个孩子:任一孩子仍是在用的主家长绑定就能回执;否则"不是主家长"先于"只读"
    wide = send(client, settings, PRINCIPAL, TARGET_SCHOOL, audience="parents", ack=CONFIRM).json()[
        "id"
    ]
    assert _item(client, settings, LI, wide)["ack_block_reason"] is None  # S0017 仍在用
    set_link(db, "13800000061", "S0017", is_primary=False)
    assert _item(client, settings, LI, wide)["ack_block_reason"] == "not_primary"
    set_link(db, "13800000061", "S0017", is_primary=True)
    make_readonly(db, "13800000061", "S0017")
    assert _item(client, settings, LI, wide)["ack_block_reason"] == "readonly"

    # 老师对象的通知不看绑定(T04 的孩子绑定上面已改成只读,仍能回执老师对象的全校通知)
    t = send(client, settings, PRINCIPAL, TARGET_SCHOOL, ack=CONFIRM).json()["id"]
    make_readonly(db, "teacher04", "S0002")
    item = _item(client, settings, T04, t)
    assert item["can_ack"] is True and item["ack_block_reason"] is None


def test_ack_block_reason_unlinked_vs_readonly(client, db, settings):
    """L231:readonly 只留给"孩子已毕业 / 离校(家长账号只读)";绑定已结束(ended_at 非空)或
    学生已删(notice_students 行随之级联消失)→ unlinked。一人多个孩子时有只读绑定就先算 readonly。"""
    n = parent_notice(client, settings, CONFIRM)
    make_readonly(db, "13800000061", "S0001")
    assert _item(client, settings, LI, n)["ack_block_reason"] == "readonly"
    set_link(
        db,
        "13800000061",
        "S0001",
        status="ended",
        ended_at=datetime.now(UTC),
        readonly_since=None,
    )
    item = _item(client, settings, LI, n)
    assert item["can_ack"] is False and item["ack_block_reason"] == "unlinked"
    res = post_ack(client, settings, LI, n)
    assert res.status_code == 403 and code(res) == "ACK_NOT_ALLOWED"
    # 另一位家长(teacher04,孩子 S0002)不受影响
    assert _item(client, settings, T04, n)["ack_block_reason"] is None

    # 学生已删:级联删掉 notice_students 行,这条通知在我名下已没有孩子
    set_link(db, "13800000061", "S0001", status="active", ended_at=None)
    assert _item(client, settings, LI, n)["ack_block_reason"] is None
    db.execute(
        text(
            "DELETE FROM notice_students WHERE notice_id = :n"
            " AND student_id = (SELECT id FROM students WHERE mk = 'S0001')"
        ),
        {"n": n},
    )
    assert _item(client, settings, LI, n)["ack_block_reason"] == "unlinked"

    # 一人多个孩子(S0001 三年二班、S0017 四年一班):一个已结束、一个只读 → readonly;都结束 → unlinked
    wide = send(client, settings, PRINCIPAL, TARGET_SCHOOL, audience="parents", ack=CONFIRM).json()[
        "id"
    ]
    set_link(db, "13800000061", "S0001", status="ended", ended_at=datetime.now(UTC))
    make_readonly(db, "13800000061", "S0017")
    assert _item(client, settings, LI, wide)["ack_block_reason"] == "readonly"
    set_link(
        db,
        "13800000061",
        "S0017",
        status="ended",
        ended_at=datetime.now(UTC),
        readonly_since=None,
    )
    assert _item(client, settings, LI, wide)["ack_block_reason"] == "unlinked"


def test_secondary_parent_cannot_ack(client, db, settings):
    """A2 遗留(submit_ack):家长对象的通知只有在用的主家长绑定能回执,
    与收件箱 ack_block_reason = not_primary 的口径一致。"""
    p = parent_notice(client, settings, CONFIRM)
    set_link(db, "13800000061", "S0001", is_primary=False)
    assert _item(client, settings, LI, p)["ack_block_reason"] == "not_primary"
    res = post_ack(client, settings, LI, p)
    assert res.status_code == 403 and code(res) == "ACK_NOT_ALLOWED"
    assert row_of(db, p, LI).acked_at is None
    failed = [r for r in ack_audits(db, p) if not r.success]
    assert len(failed) == 1 and failed[0].user_id == UUID(LI)
    set_link(db, "13800000061", "S0001", is_primary=True)
    assert post_ack(client, settings, LI, p).status_code == 204


def test_snapshot_survives_upgrade(client, db, settings):
    """L87:发送后学年升级,统计、导出与收件箱里的班名仍是发送时的班。"""
    n = parent_notice(client, settings, CHOICE)
    post_ack(client, settings, LI, n, choice=0)
    plan = suggest(db, UUID(SCHOOL_ID), "2027-2028", date(2027, 9, 1), date(2028, 7, 15))
    apply(db, UUID(SCHOOL_ID), plan, now=datetime(2027, 8, 20, tzinfo=UTC))
    now_class = db.execute(
        text(
            "SELECT c.name FROM enrollments e JOIN classes c ON c.id = e.class_id"
            " JOIN students s ON s.id = e.student_id WHERE s.mk = 'S0001' AND e.status = 'active'"
        )
    ).scalar_one()
    assert now_class == "四年二班"

    h = auth(settings, PRINCIPAL)
    stats = client.get(f"{INBOX}/{n}/acks", headers=h).json()
    assert [(r["student_name"], r["class_name"]) for r in stats["rows"]] == [
        ("王小一", "三年二班"),
        ("李小二", "三年二班"),
    ]
    text_ = client.get(f"{INBOX}/{n}/acks/export", headers=h).content.decode("utf-8")
    rows = list(csv.reader(io.StringIO(text_.removeprefix(BOM))))
    assert [r[0] for r in rows[1:]] == ["三年二班", "三年二班"]
    item = _item(client, settings, LI, n)
    assert item["students_detail"] == [{"name": "王小一", "class_name": "三年二班"}]
    # 班级删除后快照仍在(class_id 置空、班名还在);发送人对已删班的统计按 L86 隐藏,收件箱照常
    db.execute(text("DELETE FROM classes WHERE id = :c"), {"c": C32})
    assert _snapshot_rows(db, n) == {("S0001", None, "三年二班"), ("S0002", None, "三年二班")}
    item = _item(client, settings, LI, n)
    assert item["students_detail"] == [{"name": "王小一", "class_name": "三年二班"}]


def test_ack_rows_numeric_order(client, db, settings):
    """L266:回执明细按班名数值序(三年三班 < 三年七班);码位序会把"七"排到"三"前面。
    班名读的是 notice_students 快照,直接改快照即可构造。"""
    n = parent_notice(client, settings, CONFIRM)
    db.execute(
        text(
            "UPDATE notice_students ns SET class_name = CASE s.mk WHEN 'S0001' THEN '三年七班'"
            " ELSE '三年三班' END FROM students s WHERE s.id = ns.student_id AND ns.notice_id = :n"
        ),
        {"n": n},
    )
    stats = client.get(f"{INBOX}/{n}/acks", headers=auth(settings, PRINCIPAL)).json()
    assert [(r["student_name"], r["class_name"]) for r in stats["rows"]] == [
        ("李小二", "三年三班"),
        ("王小一", "三年七班"),
    ]


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


def _all_views_hidden(client, settings, who, nid, admin_status):
    n = f"{INBOX}/{nid}"
    h = auth(settings, who)
    assert client.get(f"{n}/acks", headers=h).status_code == 404
    assert client.get(f"{n}/acks/export", headers=h).status_code == 404
    # 管理端入口:完全失去发件权限的人先被 403 拦下,仍有发件权但不覆盖原对象的人得 404
    assert (
        client.get(f"/api/v1/admin/notices/{nid}/recipients", headers=h).status_code == admin_status
    )
    assert client.post(f"/api/v1/admin/notices/{nid}/recall", headers=h).status_code == admin_status


def test_former_sender_cannot_view_acks(client, db, settings):
    # 管理端通知:校长发全校,之后失去校长岗位
    nid = parent_notice(client, settings, CHOICE)
    assert client.get(f"{INBOX}/{nid}/acks", headers=auth(settings, PRINCIPAL)).status_code == 200
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = now()"
            " WHERE user_id = :u AND role_type = 'principal'"
        ),
        {"u": PRINCIPAL},
    )
    _all_views_hidden(client, settings, PRINCIPAL, nid, 403)
    assert db.get(Notice, UUID(nid)).recalled_at is None

    # 年级组长发本年级班,之后调去别的年级:作用域不再覆盖原对象
    gh = send(client, settings, GRADE_HEAD3, TARGET_C32, audience="parents", ack=CHOICE)
    assert gh.status_code == 201, gh.text
    gid = gh.json()["id"]
    assert client.get(f"{INBOX}/{gid}/acks", headers=auth(settings, GRADE_HEAD3)).status_code == 200
    db.execute(
        text(
            "UPDATE role_bindings SET scope = jsonb_build_object('grade_id', CAST(:g AS text))"
            " WHERE user_id = :u AND role_type = 'grade_head'"
        ),
        {"u": GRADE_HEAD3, "g": G4},
    )
    _all_views_hidden(client, settings, GRADE_HEAD3, gid, 404)


def test_former_homeroom_cannot_view_class_notice_acks(client, db, settings):
    res = client.post(
        f"/api/v1/classes/{C32}/notices",
        json={"title": "家长会", "content": "周五开会", "ack": CHOICE},
        headers=auth(settings, T01),
    )
    assert res.status_code == 201, res.text
    nid = res.json()["id"]
    assert client.get(f"{INBOX}/{nid}/acks", headers=auth(settings, T01)).status_code == 200
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = now()"
            " WHERE user_id = :u AND role_type = 'homeroom_teacher'"
        ),
        {"u": T01},
    )
    h = auth(settings, T01)
    assert client.get(f"{INBOX}/{nid}/acks", headers=h).status_code == 404
    assert client.get(f"{INBOX}/{nid}/acks/export", headers=h).status_code == 404
    assert client.post(f"/api/v1/classes/{C32}/notices/{nid}/recall", headers=h).status_code == 403
    assert db.get(Notice, UUID(nid)).recalled_at is None
