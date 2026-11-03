import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import anyio
import httpx
from sqlalchemy import select, text

from app.ai.gateway import GenContext, acquire_lock, lock_key, reply_events
from app.ai.settings import AIConfig, load_ai_config, save_ai_config
from app.domain.ai.schemas import AiReplyIn
from app.models import AiBatchItem, AiChat, AiMessage
from tests.conftest import _reuse
from tests.fake_llm import sse_transport
from tests.helpers import audit_rows, auth, freeze
from tests.seed_ids import (
    CLASS_ID,
    SCHOOL_ID,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_USER_ID,
)

CHATS = "/api/v1/ai/chats"
INTERRUPTED = "上次生成被中断了,可以点「重新生成」"


def configure_ai(db, settings) -> None:
    cfg = AIConfig(
        provider="custom",
        base_url="https://llm.example.test/v1",
        model="test-model",
        temperature=0.7,
        api_key="sk-test-0000",
        mask_forced=False,
    )
    save_ai_config(db, settings.school_id, settings.master_key_bytes, cfg)
    db.commit()


def read_sse(resp) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name = None
    for line in resp.iter_lines():
        if line.startswith("event: "):
            name = line[len("event: ") :]
        elif line.startswith("data: "):
            events.append((name, json.loads(line[len("data: ") :])))
    return events


def lesson_body() -> dict:
    return {
        "class_id": CLASS_ID,
        "template_id": "lesson",
        "values": {"subject": "语文", "topic": "秋天的雨"},
    }


def parent_body(mask: bool = True) -> dict:
    return {
        "class_id": CLASS_ID,
        "template_id": "parent",
        "values": {"student": STUDENT_IDS[0]},
        "mask": mask,
    }


def comments_body() -> dict:
    return {
        "class_id": CLASS_ID,
        "template_id": "comments",
        "values": {"students": [STUDENT_IDS[0], STUDENT_IDS[1]]},
    }


def create(client, settings, body, user_id=TEACHER_USER_ID) -> dict:
    r = client.post(CHATS, json=body, headers=auth(settings, user_id))
    assert r.status_code == 201, r.text
    return r.json()


def reply(client, settings, chat_id, body=None, user_id=TEACHER_USER_ID):
    return client.stream(
        "POST",
        f"{CHATS}/{chat_id}/reply",
        json=body if body is not None else {},
        headers=auth(settings, user_id),
    )


def run_reply(client, settings, chat_id, body=None) -> list[tuple[str, dict]]:
    with reply(client, settings, chat_id, body) as r:
        assert r.status_code == 200, r.read()
        return read_sse(r)


def get_chat(client, settings, chat_id, user_id=TEACHER_USER_ID):
    return client.get(f"{CHATS}/{chat_id}", headers=auth(settings, user_id))


def set_transport(client, chunks, **kw) -> list[dict]:
    rec: list[dict] = []
    client.app.state.ai_transport = sse_transport(chunks, record=rec, **kw)
    return rec


def generate_audits(db, chat_id) -> list:
    return [a for a in audit_rows(db, chat_id) if a.action == "ai.generate"]


def test_create_then_reply_streams_and_saves(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["第一段", "第二段"])
    chat = create(client, settings, lesson_body())
    assert chat["messages"][0]["content"] == "备课教案 · 语文《秋天的雨》"
    assert chat["messages"][0]["role"] == "user"
    with reply(client, settings, chat["id"]) as r:
        assert r.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-accel-buffering"] == "no"
        events = read_sse(r)
    assert [e for e, _ in events] == ["meta", "delta", "delta", "done"]
    got = get_chat(client, settings, chat["id"]).json()
    assert events[0][1]["message_id"] == got["messages"][1]["id"]
    assert got["messages"][1] == {
        **got["messages"][1],
        "role": "assistant",
        "status": "done",
        "content": "第一段第二段",
    }
    assert "sent" not in json.dumps(got)


def test_create_chat_rows_and_fields(client, settings, db):
    chat = create(client, settings, parent_body())
    assert chat["template_id"] == "parent" and chat["student_id"] == STUDENT_IDS[0]
    assert chat["mask"] is True and chat["batch_only"] is False and chat["items"] == []
    assert chat["class_id"] == CLASS_ID and chat["save_as"] is None
    row = db.get(AiChat, UUID(chat["id"]))
    assert row.params["student"] == STUDENT_IDS[0]
    msg = db.scalars(select(AiMessage).where(AiMessage.chat_id == row.id)).one()
    assert "【学生01】" in msg.sent and "王小一" not in msg.sent and msg.content == chat["title"]


def test_create_batch_chat(client, settings, db):
    chat = create(client, settings, comments_body())
    assert chat["batch_only"] is True and chat["save_as"] == "comment"
    assert len(chat["messages"]) == 1 and chat["messages"][0]["role"] == "user"
    assert [i["student_id"] for i in chat["items"]] == STUDENT_IDS[:2]
    assert all(i["status"] == "wait" and i["content"] == "" for i in chat["items"])
    assert chat["items"][0]["student_name"] == "王小一"
    msg = db.scalars(select(AiMessage).where(AiMessage.chat_id == UUID(chat["id"]))).one()
    assert msg.sent is None


def test_batch_chat_rejects_reply(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, comments_body())
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={}, headers=auth(settings))
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_BATCH_ONLY"


def test_reply_streams_real_names_when_code_is_split(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["【学", "生01】这学期", "进步很大"])
    chat = create(client, settings, parent_body())
    events = run_reply(client, settings, chat["id"])
    text_out = "".join(d["text"] for e, d in events if e == "delta")
    assert text_out == "王小一这学期进步很大"
    got = get_chat(client, settings, chat["id"]).json()
    assert got["messages"][1]["content"] == "王小一这学期进步很大"


def test_outgoing_request_has_no_names_or_phones(client, settings, db):
    configure_ai(db, settings)
    db.execute(
        text("UPDATE students SET family_note = '父亲电话 13800000011' WHERE id = :i"),
        {"i": STUDENT_IDS[0]},
    )
    db.commit()
    rec = set_transport(client, ["【学生01】表现不错"])
    chat = create(client, settings, parent_body())
    run_reply(client, settings, chat["id"])
    run_reply(client, settings, chat["id"], {"text": "王小一最近怎么样"})
    assert len(rec) == 2
    for req in rec:
        dumped = json.dumps(req, ensure_ascii=False)
        assert "王小一" not in dumped and "13800000011" not in dumped
        assert "【学生01】" in dumped


def test_follow_up_and_regenerate(client, settings, db):
    configure_ai(db, settings)
    rec = set_transport(client, ["王小一进步", "很大"])
    chat = create(client, settings, parent_body())
    run_reply(client, settings, chat["id"])
    run_reply(client, settings, chat["id"], {"text": "再短一点"})
    got = get_chat(client, settings, chat["id"]).json()
    assert [m["role"] for m in got["messages"]] == ["user", "assistant", "user", "assistant"]
    assert got["messages"][2]["content"] == "再短一点"
    first_sent = db.scalars(
        select(AiMessage.sent).where(
            AiMessage.chat_id == UUID(chat["id"]), AiMessage.role == "user"
        )
    ).first()
    second = rec[1]["messages"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "user"]
    assert second[1]["content"] == first_sent
    assert second[2]["content"] == "【学生01】进步很大"
    assert second[3]["content"] == "再短一点"

    set_transport(client, ["新回复"])
    run_reply(client, settings, chat["id"], {"regenerate": True})
    got = get_chat(client, settings, chat["id"]).json()
    assert len(got["messages"]) == 4 and got["messages"][3]["content"] == "新回复"


def test_nothing_to_reply(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["好"])
    chat = create(client, settings, lesson_body())
    run_reply(client, settings, chat["id"])
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={}, headers=auth(settings))
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_NOTHING_TO_REPLY"


def test_not_configured(client, settings, db, redis_client):
    chat = create(client, settings, lesson_body())
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={}, headers=auth(settings))
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_NOT_CONFIGURED"
    assert r.headers["content-type"].startswith("application/json")
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0


def test_busy_lock(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    redis_client.set(f"ai:chat:{chat['id']}", "someone-else", ex=60)
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={}, headers=auth(settings))
    assert r.status_code == 409 and r.json()["error"]["code"] == "AI_BUSY"
    assert redis_client.get(f"ai:chat:{chat['id']}") == "someone-else"


def test_reply_body_validation(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={"text": "   "}, headers=auth(settings))
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"


def test_upstream_error_mid_stream(client, settings, db, redis_client):
    configure_ai(db, settings)
    set_transport(client, ["你好", "世界"], fail_after=1)
    chat = create(client, settings, lesson_body())
    events = run_reply(client, settings, chat["id"])
    assert [e for e, _ in events] == ["meta", "delta", "error"]
    assert events[2][1]["code"] == "AI_UNREACHABLE" and events[2][1]["message"]
    msg = get_chat(client, settings, chat["id"]).json()["messages"][1]
    assert msg["status"] == "error" and msg["content"] == "你好" and msg["error"]
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    audit = generate_audits(db, chat["id"])
    assert len(audit) == 1 and audit[0].extra["outcome"] == "error"
    assert audit[0].extra["prompt_tokens"] is None


def test_http_error_before_first_token(client, settings, db, redis_client):
    configure_ai(db, settings)
    set_transport(client, ["x"], status=401)
    chat = create(client, settings, lesson_body())
    events = run_reply(client, settings, chat["id"])
    assert [e for e, _ in events] == ["meta", "error"]
    assert events[1][1]["code"] == "AI_KEY_INVALID"
    msg = get_chat(client, settings, chat["id"]).json()["messages"][1]
    assert msg["status"] == "error" and msg["content"] == ""
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    # 随后可以立即重新生成
    set_transport(client, ["好了"])
    events = run_reply(client, settings, chat["id"], {"regenerate": True})
    assert [e for e, _ in events][-1] == "done"


def _ctx(client, settings, db, redis_client, chat_id: str, chunks) -> GenContext:
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    return GenContext(
        chat_id=UUID(chat_id),
        user_id=UUID(TEACHER_USER_ID),
        school_id=UUID(SCHOOL_ID),
        class_id=UUID(CLASS_ID),
        cfg=cfg,
        transport=sse_transport(chunks),
        scope=_reuse(db),
        redis=redis_client,
        lock_key=lock_key(UUID(chat_id)),
        lock_token=acquire_lock(redis_client, UUID(chat_id)),
        ip=None,
        user_agent=None,
    )


def _assert_stopped(client, settings, db, redis_client, chat_id: str, expected: str):
    msg = get_chat(client, settings, chat_id).json()["messages"][1]
    assert msg["status"] == "stopped" and msg["content"] == expected
    assert redis_client.exists(f"ai:chat:{chat_id}") == 0
    audit = generate_audits(db, chat_id)
    assert len(audit) == 1 and audit[0].extra["outcome"] == "stopped"
    assert audit[0].extra["chars_out"] >= len(expected) - 2
    # 停止后可以立即重新生成
    set_transport(client, ["新回复"])
    events = run_reply(client, settings, chat_id, {"regenerate": True})
    assert events[-1][0] == "done"


def test_disconnect_saves_partial_and_releases_lock(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body())
    ctx = _ctx(
        client, settings, db, redis_client, chat["id"], ["【学生01】很棒", "第二段", "第三段"]
    )

    async def drive() -> list[str]:
        agen = reply_events(ctx, AiReplyIn())
        names = []
        async for chunk in agen:
            name = chunk.decode().split("\n", 1)[0].removeprefix("event: ")
            names.append(name)
            if name == "delta":
                break
        await agen.aclose()
        return names

    assert asyncio.run(drive()) == ["meta", "delta"]
    _assert_stopped(client, settings, db, redis_client, chat["id"], "王小一很棒")


def _slow_transport(chunks: list[str]) -> httpx.MockTransport:
    async def body():
        for text_ in chunks:
            payload = {"choices": [{"delta": {"content": text_}}]}
            yield b"data: " + json.dumps(payload, ensure_ascii=False).encode() + b"\n\n"
            await anyio.sleep(0.5)
        yield b"data: [DONE]\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())

    return httpx.MockTransport(handler)


def test_cancellation_saves_partial_and_releases_lock(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body())
    ctx = _ctx(client, settings, db, redis_client, chat["id"], [])
    ctx.transport = _slow_transport(["【学生01】很棒", "第二段", "第三段"])

    async def drive() -> None:
        got = anyio.Event()

        async def consume() -> None:
            async for chunk in reply_events(ctx, AiReplyIn()):
                if chunk.startswith(b"event: delta"):
                    got.set()

        with anyio.CancelScope() as scope:
            async with anyio.create_task_group() as tg:
                tg.start_soon(consume)
                await got.wait()
                scope.cancel()

    anyio.run(drive)
    _assert_stopped(client, settings, db, redis_client, chat["id"], "王小一很棒")


def test_stale_streaming_shown_as_interrupted(client, settings, db, monkeypatch):
    chat = create(client, settings, lesson_body())
    db.add(
        AiMessage(
            chat_id=UUID(chat["id"]), role="assistant", content="半截内容", status="streaming"
        )
    )
    db.commit()
    assert get_chat(client, settings, chat["id"]).json()["messages"][1]["status"] == "streaming"
    headers = auth(settings)
    freeze(monkeypatch, (datetime.now(UTC) + timedelta(minutes=3)).isoformat())
    msg = client.get(f"{CHATS}/{chat['id']}", headers=headers).json()["messages"][1]
    assert msg["status"] == "error" and msg["error"] == INTERRUPTED
    assert msg["content"] == "半截内容"


def test_stale_running_item_shown_as_wait(client, settings, db, monkeypatch):
    chat = create(client, settings, comments_body())
    item = db.scalars(select(AiBatchItem).where(AiBatchItem.chat_id == UUID(chat["id"]))).first()
    item.status = "run"
    db.commit()
    headers = auth(settings)
    got = client.get(f"{CHATS}/{chat['id']}", headers=headers).json()
    assert got["items"][0]["status"] == "run"
    freeze(monkeypatch, (datetime.now(UTC) + timedelta(minutes=3)).isoformat())
    got = client.get(f"{CHATS}/{chat['id']}", headers=headers).json()
    assert got["items"][0]["status"] == "wait" and got["items"][1]["status"] == "wait"


def test_other_users_chat_is_404(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    cid = chat["id"]
    other = auth(settings, SUBJECT_USER_ID)
    assert client.get(f"{CHATS}/{cid}", headers=other).status_code == 404
    assert client.get(f"{CHATS}/{cid}/prompt", headers=other).status_code == 404
    assert client.delete(f"{CHATS}/{cid}", headers=other).status_code == 404
    r = client.post(f"{CHATS}/{cid}/reply", json={}, headers=other)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert client.get(f"{CHATS}/{cid}", headers=auth(settings)).status_code == 200


def test_delete_chat(client, settings, db):
    chat = create(client, settings, lesson_body())
    assert client.delete(f"{CHATS}/{chat['id']}", headers=auth(settings)).status_code == 204
    assert get_chat(client, settings, chat["id"]).status_code == 404
    left = db.scalars(select(AiMessage).where(AiMessage.chat_id == UUID(chat["id"]))).all()
    assert left == []


def test_permission_rechecked_on_reply(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body())
    db.execute(text("DELETE FROM role_bindings WHERE user_id = :u"), {"u": TEACHER_USER_ID})
    db.commit()
    r = client.post(f"{CHATS}/{chat['id']}/reply", json={}, headers=auth(settings))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"


def test_list_recent_chats(client, settings, db):
    ids = [
        create(client, settings, lesson_body())["id"],
        create(client, settings, parent_body())["id"],
        create(client, settings, comments_body())["id"],
    ]
    create(client, settings, lesson_body(), SUBJECT_USER_ID)
    r = client.get(f"{CHATS}?class_id={CLASS_ID}", headers=auth(settings))
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["id"] for i in items] == ids[::-1]
    assert set(items[0]) == {"id", "title", "template_id", "updated_at"}
    other = client.get(f"{CHATS}?class_id={CLASS_ID}", headers=auth(settings, SUBJECT_USER_ID))
    assert len(other.json()["items"]) == 1


def test_list_chats_capped_at_20(client, settings, db):
    for _ in range(22):
        create(client, settings, lesson_body())
    r = client.get(f"{CHATS}?class_id={CLASS_ID}", headers=auth(settings))
    assert len(r.json()["items"]) == 20


def test_chat_prompt_for_copy(client, settings, db):
    chat = create(client, settings, parent_body())
    r = client.get(f"{CHATS}/{chat['id']}/prompt", headers=auth(settings))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["prompt"].startswith("你是一位熟悉中国中小学教育的班主任助手")
    assert "【学生01】" in body["prompt"] and "王小一" not in body["prompt"]
    assert {"code": "【学生01】", "name": "王小一"} in body["mapping"]
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "ai.prompt_copy"]
    assert rows and rows[-1].extra["template"] == "parent"
    assert (
        client.get(
            f"{CHATS}/{chat['id']}/prompt", headers=auth(settings, SUBJECT_USER_ID)
        ).status_code
        == 404
    )


def test_chat_prompt_for_batch_chat(client, settings, db):
    chat = create(client, settings, comments_body())
    body = client.get(f"{CHATS}/{chat['id']}/prompt", headers=auth(settings)).json()
    assert "=== 第 1 位 ===" in body["prompt"] and "=== 第 2 位 ===" in body["prompt"]
    assert "王小一" in body["prompt"]
    assert body["mapping"] == []


def test_generate_audit(client, settings, db):
    configure_ai(db, settings)
    set_transport(client, ["【学生01】进步很大"])
    chat = create(client, settings, parent_body())
    run_reply(client, settings, chat["id"])
    rows = generate_audits(db, chat["id"])
    assert len(rows) == 1
    row = rows[0]
    assert row.object_type == "ai_chat" and row.success is True
    assert row.user_id == UUID(TEACHER_USER_ID)
    extra = row.extra
    assert set(extra) == {
        "template",
        "student_ids",
        "provider",
        "model",
        "masked",
        "outcome",
        "prompt_tokens",
        "completion_tokens",
        "chars_in",
        "chars_out",
    }
    assert extra["template"] == "parent" and extra["student_ids"] == [STUDENT_IDS[0]]
    assert extra["provider"] == "custom" and extra["model"] == "test-model"
    assert extra["masked"] is True and extra["outcome"] == "done"
    assert extra["prompt_tokens"] == 12 and extra["completion_tokens"] == 34
    assert extra["chars_in"] > 100 and extra["chars_out"] == len("【学生01】进步很大")
    assert "【任务】" not in json.dumps(extra, ensure_ascii=False)
    msg = db.scalars(
        select(AiMessage).where(
            AiMessage.chat_id == UUID(chat["id"]), AiMessage.role == "assistant"
        )
    ).one()
    assert (msg.prompt_tokens, msg.completion_tokens) == (12, 34)


def test_forced_mask_applies_to_chat_created_unmasked(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body(mask=False))
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    cfg.mask_forced = True
    save_ai_config(db, settings.school_id, settings.master_key_bytes, cfg)
    db.commit()
    rec = set_transport(client, ["【学生01】很棒"])
    events = run_reply(client, settings, chat["id"], {"text": "王小一最近怎么样"})
    assert events[-1][0] == "done"
    body = json.dumps(rec[0], ensure_ascii=False)
    for name in ("王小一", "李小二", "张小三"):
        assert name not in body
    assert "【学生01】" in body
    assert generate_audits(db, chat["id"])[0].extra["masked"] is True
    got = get_chat(client, settings, chat["id"]).json()
    assert got["messages"][-1]["content"] == "王小一很棒"


def _state_at_final_event(client, settings, db, redis_client, chat_id, events_fn, ctx, final):
    """逐个读事件;收到 done / error 的当下立刻查库与锁。"""
    seen: dict = {}

    async def drive():
        agen = events_fn(ctx)
        async for chunk in agen:
            if chunk.startswith(f"event: {final}".encode()):
                db.expire_all()
                seen["chat"] = get_chat(client, settings, chat_id).json()
                seen["lock"] = redis_client.exists(f"ai:chat:{chat_id}")
                seen["audits"] = len(generate_audits(db, chat_id))
        await agen.aclose()

    asyncio.run(drive())
    return seen


def test_reply_done_event_after_save_and_unlock(client, settings, db, redis_client):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body())
    ctx = _ctx(client, settings, db, redis_client, chat["id"], ["第一段", "第二段"])
    seen = _state_at_final_event(
        client, settings, db, redis_client, chat["id"],
        lambda c: reply_events(c, AiReplyIn()), ctx, "done",
    )  # fmt: skip
    msg = seen["chat"]["messages"][1]
    assert (msg["status"], msg["content"]) == ("done", "第一段第二段")
    assert seen["lock"] == 0 and seen["audits"] == 1
    assert len(generate_audits(db, chat["id"])) == 1


def test_reply_error_event_after_save_and_unlock(client, settings, db, redis_client):
    configure_ai(db, settings)
    for kw, code in (({"fail_after": 1}, "AI_UNREACHABLE"), ({"status": 401}, "AI_KEY_INVALID")):
        chat = create(client, settings, parent_body())
        ctx = _ctx(client, settings, db, redis_client, chat["id"], ["你好", "世界"])
        ctx.transport = sse_transport(["你好", "世界"], **kw)
        seen = _state_at_final_event(
            client, settings, db, redis_client, chat["id"],
            lambda c: reply_events(c, AiReplyIn()), ctx, "error",
        )  # fmt: skip
        assert seen["chat"]["messages"][1]["status"] == "error", code
        assert seen["lock"] == 0 and seen["audits"] == 1
        assert len(generate_audits(db, chat["id"])) == 1


def _force_mask(db, settings) -> None:
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    cfg.mask_forced = True
    save_ai_config(db, settings.school_id, settings.master_key_bytes, cfg)
    db.commit()


def test_prompt_copy_honours_forced_mask(client, settings, db):
    configure_ai(db, settings)
    chat = create(client, settings, parent_body(mask=False))
    before = client.get(f"{CHATS}/{chat['id']}/prompt", headers=auth(settings)).json()
    assert "王小一" in before["prompt"] and before["mapping"] == []
    _force_mask(db, settings)
    body = client.get(f"{CHATS}/{chat['id']}/prompt", headers=auth(settings)).json()
    assert "王小一" not in body["prompt"] and "【学生01】" in body["prompt"]
    assert {"code": "【学生01】", "name": "王小一"} in body["mapping"]
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "ai.prompt_copy"]
    assert rows[-1].extra["masked"] is True


def test_prompt_copy_batch_honours_forced_mask(client, settings, db):
    configure_ai(db, settings)
    body = {**comments_body(), "mask": False}
    chat = create(client, settings, body)
    _force_mask(db, settings)
    got = client.get(f"{CHATS}/{chat['id']}/prompt", headers=auth(settings)).json()
    assert "王小一" not in got["prompt"] and "李小二" not in got["prompt"]
    assert "【学生01】" in got["prompt"] and "=== 第 2 位 ===" in got["prompt"]
    assert {"code": "【学生01】", "name": "王小一"} in got["mapping"]
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "ai.prompt_copy"]
    assert rows[-1].extra["masked"] is True
    assert rows[-1].extra["student_ids"] == [STUDENT_IDS[0], STUDENT_IDS[1]]


def test_reply_rechecks_nothing_to_reply_under_lock(
    client, settings, db, redis_client, monkeypatch
):
    from app.domain.ai import router as ai_router

    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    real = ai_router.acquire_lock

    def racing_acquire(redis, chat_id):
        token = real(redis, chat_id)
        # 另一个请求在我们拿到锁之前已经写好了回复
        db.add(AiMessage(chat_id=UUID(chat["id"]), role="assistant", content="已有", status="done"))
        db.commit()
        return token

    monkeypatch.setattr(ai_router, "acquire_lock", racing_acquire)
    with reply(client, settings, chat["id"]) as r:
        assert r.status_code == 409
        assert json.loads(r.read())["error"]["code"] == "AI_NOTHING_TO_REPLY"
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    assert len(get_chat(client, settings, chat["id"]).json()["messages"]) == 2
