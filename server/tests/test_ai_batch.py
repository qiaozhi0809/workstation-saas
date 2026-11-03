import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.ai.gateway import acquire_lock, run_item_events
from app.models import AiBatchItem, Enrollment
from tests.helpers import auth, freeze
from tests.seed_ids import CLASS_ID, EXAM_IDS, STUDENT_IDS, SUBJECT_USER_ID
from tests.test_ai_chats import (
    CHATS,
    _ctx,
    configure_ai,
    create,
    generate_audits,
    get_chat,
    read_sse,
    set_transport,
)
from tests.test_ai_templates import _compare_exam


def comments_body(ids: list[str], mask: bool = False) -> dict:
    return {
        "class_id": CLASS_ID,
        "template_id": "comments",
        "values": {"students": ids},
        "mask": mask,
    }


def run_item(client, settings, chat_id, item_id, user_id=None):
    headers = auth(settings, user_id) if user_id else auth(settings)
    return client.stream("POST", f"{CHATS}/{chat_id}/items/{item_id}/run", headers=headers)


def do_run(client, settings, chat_id, item_id) -> list[tuple[str, dict]]:
    with run_item(client, settings, chat_id, item_id) as r:
        assert r.status_code == 200, r.read()
        return read_sse(r)


def post_run(client, settings, chat_id, item_id, user_id=None):
    headers = auth(settings, user_id) if user_id else auth(settings)
    return client.post(f"{CHATS}/{chat_id}/items/{item_id}/run", headers=headers)


def test_create_comments_batch_items(client, settings, db):
    ids = [STUDENT_IDS[2], STUDENT_IDS[0], STUDENT_IDS[1]]
    chat = create(client, settings, comments_body(ids))
    assert chat["batch_only"] and chat["save_as"] == "comment"
    assert [i["student_name"] for i in chat["items"]] == ["王小一", "李小二", "张小三"]
    assert all(i["status"] == "wait" and i["note"] is None for i in chat["items"])


def test_run_item_streams_and_marks_done(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["王小一本学期", "进步很大"])
    chat = create(client, settings, comments_body(STUDENT_IDS[:2], mask=True))
    first, second = chat["items"]
    events = do_run(client, settings, chat["id"], first["id"])
    assert [e for e, _ in events] == ["meta", "delta", "delta", "done"]
    assert events[0][1] == {"item_id": first["id"]}
    got = get_chat(client, settings, chat["id"]).json()
    assert (
        got["items"][0]["status"] == "done" and got["items"][0]["content"] == "王小一本学期进步很大"
    )
    assert got["items"][1]["status"] == "wait" and got["items"][1]["content"] == ""
    rows = generate_audits(db, chat["id"])
    assert len(rows) == 1 and rows[0].extra["student_ids"] == [STUDENT_IDS[0]]
    assert rows[0].extra["masked"] is True


def test_run_restores_real_name_from_code(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["【学", "生01】很棒"])
    chat = create(client, settings, comments_body(STUDENT_IDS[:2], mask=True))
    do_run(client, settings, chat["id"], chat["items"][0]["id"])
    got = get_chat(client, settings, chat["id"]).json()
    assert got["items"][0]["content"] == "王小一很棒"


def test_run_done_item_conflict(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["好"])
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    item_id = chat["items"][0]["id"]
    do_run(client, settings, chat["id"], item_id)
    r = post_run(client, settings, chat["id"], item_id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_NOTHING_TO_REPLY"


def test_reply_on_batch_chat_conflict(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    r = client.post(
        f"{CHATS}/{chat['id']}/reply", json={"text": "再写一遍"}, headers=auth(settings)
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_BATCH_ONLY"


def test_batch_item_error(client, settings, db, redis_client):
    configure_ai(db, settings)
    set_transport(client, [], status=429)
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    item_id = chat["items"][0]["id"]
    events = do_run(client, settings, chat["id"], item_id)
    assert events[-1][0] == "error" and events[-1][1]["code"] == "AI_RATE_LIMITED"
    item = get_chat(client, settings, chat["id"]).json()["items"][0]
    assert item["status"] == "err" and item["error"]
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    set_transport(client, ["第二次成功"])
    events = do_run(client, settings, chat["id"], item_id)
    assert events[-1][0] == "done"
    item = get_chat(client, settings, chat["id"]).json()["items"][0]
    assert item["status"] == "done" and item["error"] is None and item["content"] == "第二次成功"


def test_batch_item_stop_returns_to_wait(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    item_id = chat["items"][0]["id"]
    ctx = _ctx(client, settings, db, redis_client, chat["id"], ["第一段", "第二段", "第三段"])

    async def drive() -> list[str]:
        agen = run_item_events(ctx, UUID(item_id))
        names = []
        async for chunk in agen:
            name = chunk.decode().split("\n", 1)[0].removeprefix("event: ")
            names.append(name)
            if name == "delta":
                break
        await agen.aclose()
        return names

    assert asyncio.run(drive()) == ["meta", "delta"]
    item = get_chat(client, settings, chat["id"]).json()["items"][0]
    assert item["status"] == "wait" and item["content"] == ""
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    audit = generate_audits(db, chat["id"])
    assert len(audit) == 1 and audit[0].extra["outcome"] == "stopped"
    assert audit[0].extra["student_ids"] == [STUDENT_IDS[0]]


def test_parent_batch_items_with_note(client, settings, db):
    configure_ai(db, settings)
    compare = _compare_exam(db)
    db.commit()
    body = {
        "class_id": CLASS_ID,
        "template_id": "parent-batch",
        "values": {"exam": EXAM_IDS[1], "vs": str(compare.id)},
    }
    chat = create(client, settings, body)
    assert chat["batch_only"] is True
    assert [(i["student_name"], i["note"], i["status"]) for i in chat["items"]] == [
        ("张小三", "退步 6 名", "wait")
    ]
    rec = set_transport(client, ["您好"])
    events = do_run(client, settings, chat["id"], chat["items"][0]["id"])
    assert events[-1][0] == "done"
    assert "后退了 6 名" in rec[0]["messages"][1]["content"]
    assert len(rec[0]["messages"]) == 2


def test_item_prompt_uses_that_student_only(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, comments_body(STUDENT_IDS[:3]))
    rec = set_transport(client, ["好"])
    second = chat["items"][1]
    assert second["student_name"] == "李小二"
    do_run(client, settings, chat["id"], second["id"])
    assert len(rec) == 1
    sent = rec[0]["messages"][1]["content"]
    assert [m["role"] for m in rec[0]["messages"]] == ["system", "user"]
    assert sent.count("【学生档案】") == 1 and "李小二" in sent
    assert "王小一" not in sent and "张小三" not in sent
    assert "王小一" not in rec[0]["messages"][0]["content"]


def test_run_item_prechecks(client, settings, db, redis_client):
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    item_id = chat["items"][0]["id"]
    # 未配置 AI
    r = post_run(client, settings, chat["id"], item_id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_NOT_CONFIGURED"
    configure_ai(db, settings)
    # 别人的对话 / 缺权限的任课老师
    r = post_run(client, settings, chat["id"], item_id, SUBJECT_USER_ID)
    assert r.status_code == 404
    # 不属于该对话的条目
    other = create(client, settings, comments_body(STUDENT_IDS[:1]))
    r = post_run(client, settings, chat["id"], other["items"][0]["id"])
    assert r.status_code == 404
    r = post_run(client, settings, chat["id"], "00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    # 非批量对话
    single = create(
        client,
        settings,
        {"class_id": CLASS_ID, "template_id": "parent", "values": {"student": STUDENT_IDS[0]}},
    )
    r = post_run(client, settings, single["id"], item_id)
    assert r.status_code == 404
    # 忙
    acquire_lock(redis_client, chat["id"])
    r = post_run(client, settings, chat["id"], item_id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_BUSY"


def test_stale_run_item_can_be_rerun(client, settings, db, monkeypatch):
    configure_ai(db, settings)
    set_transport(client, ["好"])
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    item = db.scalars(select(AiBatchItem).where(AiBatchItem.chat_id == UUID(chat["id"]))).first()
    item.status = "run"
    db.commit()
    r = post_run(client, settings, chat["id"], str(item.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_NOTHING_TO_REPLY"
    freeze(monkeypatch, (datetime.now(UTC) + timedelta(minutes=3)).isoformat())
    r = post_run(client, settings, chat["id"], str(item.id))
    assert r.status_code == 200


def test_run_item_student_left_class(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, comments_body(STUDENT_IDS[:2]))
    enr = db.scalars(
        select(Enrollment).where(Enrollment.student_id == UUID(STUDENT_IDS[0]))
    ).first()
    enr.status = "transferred"
    db.commit()
    r = post_run(client, settings, chat["id"], chat["items"][0]["id"])
    err = r.json()["error"]
    assert r.status_code == 400 and err["code"] == "AI_FIELD_INVALID"
    assert err["details"]["field"] == "students"
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
