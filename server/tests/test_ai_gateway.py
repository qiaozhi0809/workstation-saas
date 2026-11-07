"""生成网关(app.ai.gateway)的收尾路径:断开、落库失败、长生成的心跳(v1.1 L246–L248)。

对话 / 批量的业务用例在 test_ai_chats.py、test_ai_batch.py;这里只测生命周期边界。"""

import asyncio
import contextlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import anyio
import httpx
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from structlog.testing import capture_logs

import app.ai.gateway as gw
from app.ai.gateway import reply_events, sse
from app.domain.ai.schemas import AiReplyIn
from app.models import AiMessage
from tests.helpers import auth, freeze
from tests.test_ai_chats import (
    CHATS,
    _asgi_scope,
    _ctx,
    configure_ai,
    create,
    generate_audits,
    get_chat,
    lesson_body,
    set_transport,
)


def _events_until_error(agen) -> tuple[list[tuple[str, dict]], BaseException | None]:
    """跑生成器直到结束或抛错;返回 (事件列表, 抛出的异常)。"""
    chunks: list[str] = []
    raised: list[BaseException] = []

    async def run():
        async with contextlib.aclosing(agen) as it:
            try:
                async for chunk in it:
                    chunks.append(chunk.decode())
            except Exception as e:  # 测试要拿到被抛出的那个异常
                raised.append(e)

    asyncio.run(run())
    events = []
    for chunk in chunks:
        head, _, data = chunk.strip().partition("\n")
        events.append((head.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events, raised[0] if raised else None


def test_finalize_failure_still_emits_error_event(client, settings, db, redis_client, monkeypatch):
    """L247:服务商流中途抛了意料之外的异常(走 ``except Exception`` 分支),随后落库 ``_finalize``
    自己也失败(数据库不可用):前端仍要先收到 error 终结事件,然后错误才抛给服务器;
    记 ``ai.finalize_failed``;锁照样释放。"""
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    ctx = _ctx(client, settings, db, redis_client, chat["id"], ["第一段"])

    async def exploding_provider(ctx_, prep, state):
        yield sse("delta", {"text": "第一段"})
        raise RuntimeError("provider exploded")

    def db_down(ctx_, prep, state, save):
        raise OperationalError("UPDATE ai_chats", None, Exception("connection refused"))

    monkeypatch.setattr(gw, "stream_provider", exploding_provider)
    monkeypatch.setattr(gw, "_finalize", db_down)
    with capture_logs() as logs:
        events, raised = _events_until_error(reply_events(ctx, AiReplyIn()))
    assert [e for e, _ in events] == ["meta", "delta", "error"]
    assert events[-1][1] == {"code": "AI_UPSTREAM", "message": gw.GENERIC_ERROR}
    assert isinstance(raised, OperationalError)
    assert [log["event"] for log in logs if log["event"] == "ai.finalize_failed"] == [
        "ai.finalize_failed"
    ]
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0


def test_disconnect_before_first_token_writes_no_audit(client, settings, db, redis_client):
    """L248:ASGI 2.3 下客户端在取第一口之前就断开——生成器被起来又立刻取消,``_run_prepare``
    没跑(prep 为 None,根本没进入生成):锁照放,但不该留下一条 template=None、outcome=stopped
    的 ``ai.generate`` 审计噪音;也没有助手消息。"""
    configure_ai(db, settings)
    set_transport(client, ["第一段"])
    chat = create(client, settings, lesson_body())
    body = b"{}"
    scope = _asgi_scope(f"{CHATS}/{chat['id']}/reply", auth(settings), body, "2.3")
    pending = [{"type": "http.request", "body": body, "more_body": False}]
    sent: list[str] = []

    async def receive():
        return pending.pop(0) if pending else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message["type"])

    anyio.run(client.app, scope, receive, send)
    assert "http.response.body" not in sent
    assert redis_client.exists(f"ai:chat:{chat['id']}") == 0
    db.expire_all()
    assert generate_audits(db, chat["id"]) == []
    assert len(get_chat(client, settings, chat["id"]).json()["messages"]) == 1


# ---------------------------------------------------------------- L246 心跳


def _clock_advancing_transport(monkeypatch, chunks: list[str], step_seconds: int):
    """假 LLM:每段之间把 app.clock 拨快 ``step_seconds``,模拟一次生成拖了很久。"""
    base = datetime.now(UTC)

    async def body():
        for i, text_ in enumerate(chunks):
            if i:
                freeze(monkeypatch, (base + timedelta(seconds=step_seconds * i)).isoformat())
            payload = {"choices": [{"delta": {"content": text_}}]}
            yield b"data: " + json.dumps(payload, ensure_ascii=False).encode() + b"\n\n"
        yield b"data: [DONE]\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())

    return httpx.MockTransport(handler)


def _spy(monkeypatch, name: str) -> list:
    """包一层 gateway 里的函数,记录每次调用的返回值。"""
    real = getattr(gw, name)
    calls: list = []

    def wrapped(*args, **kwargs):
        result = real(*args, **kwargs)
        calls.append(result)
        return result

    monkeypatch.setattr(gw, name, wrapped)
    return calls


def test_long_generation_keeps_lock(client, settings, db, redis_client, monkeypatch):
    """L246:一次生成超过 LOCK_TTL(300 s):流式期间每 60 s 心跳一次——锁续回 LOCK_TTL、
    目标行 updated_at 刷新;并发读取仍显示"生成中",不会因为锁过期而让新一次生成并行写同一对话。
    假 LLM 分 3 段,段与段之间把时钟拨快 151 s(整场 302 s > 300 s)。"""
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    key = f"ai:chat:{chat['id']}"
    ctx = _ctx(client, settings, db, redis_client, chat["id"], [])
    ctx.transport = _clock_advancing_transport(monkeypatch, ["第一段", "第二段", "第三段"], 151)
    redis_client.expire(key, 20)  # 把锁剩余时间压短,好看出心跳有没有把它续回 LOCK_TTL
    renewals = _spy(monkeypatch, "renew_lock")
    seen: dict = {}

    def updated_at(message_id: str):
        db.expire_all()
        return db.scalar(select(AiMessage.updated_at).where(AiMessage.id == UUID(message_id)))

    async def drive() -> list[str]:
        names: list[str] = []
        agen = reply_events(ctx, AiReplyIn())
        async for chunk in agen:
            name = chunk.decode().split("\n", 1)[0].removeprefix("event: ")
            names.append(name)
            if name == "meta":
                seen["message_id"] = json.loads(chunk.decode().split("data: ", 1)[1])["message_id"]
            if name == "delta" and names.count("delta") == 1:
                seen["ttl_before"] = redis_client.ttl(key)
                seen["updated_before"] = updated_at(seen["message_id"])
            if name == "delta" and names.count("delta") == 3:
                # 时钟已过 302 s:锁还在且已续期;并发读取按锁判断仍是"生成中"而不是"中断"
                seen["ttl_after"] = redis_client.ttl(key)
                seen["updated_after"] = updated_at(seen["message_id"])
                seen["status"] = get_chat(client, settings, chat["id"]).json()["messages"][1][
                    "status"
                ]
        return names

    assert asyncio.run(drive()) == ["meta", "delta", "delta", "delta", "done"]
    assert 0 < seen["ttl_before"] <= 20
    assert seen["ttl_after"] > 20 and seen["ttl_after"] <= gw.LOCK_TTL
    assert renewals == [True, True]  # 151 s 与 302 s 各一次
    assert seen["updated_after"] != seen["updated_before"]  # 心跳碰过目标行
    assert seen["status"] == "streaming"
    # 生成结束照常收尾:锁放掉、内容完整
    assert redis_client.exists(key) == 0
    msg = get_chat(client, settings, chat["id"]).json()["messages"][1]
    assert (msg["status"], msg["content"]) == ("done", "第一段第二段第三段")


def test_heartbeat_does_not_revive_foreign_lock(client, settings, db, redis_client, monkeypatch):
    """Review Focus 3:锁已经过期、被另一次生成(别的 run id)拿走,本次的心跳不能替人家续期,
    收尾时也不能把人家的锁删掉;本次生成自己照常结束并保存。"""
    configure_ai(db, settings)
    chat = create(client, settings, lesson_body())
    key = f"ai:chat:{chat['id']}"
    ctx = _ctx(client, settings, db, redis_client, chat["id"], [])
    ctx.transport = _clock_advancing_transport(monkeypatch, ["第一段", "第二段", "第三段"], 151)
    # 锁值换成别人的 run id(与本次 ctx.lock_token 不同),剩余 40 s
    redis_client.set(key, "another-run-token", ex=40)
    assert ctx.lock_token != "another-run-token"
    renewals = _spy(monkeypatch, "renew_lock")
    events, raised = _events_until_error(reply_events(ctx, AiReplyIn()))
    assert raised is None
    assert [e for e, _ in events] == ["meta", "delta", "delta", "delta", "done"]
    assert renewals == [False, False]  # 心跳跑了两次,都因为锁不是自己的而没续
    assert redis_client.get(key) == "another-run-token"
    assert 0 < redis_client.ttl(key) <= 40
    msg = get_chat(client, settings, chat["id"]).json()["messages"][1]
    assert (msg["status"], msg["content"]) == ("done", "第一段第二段第三段")
