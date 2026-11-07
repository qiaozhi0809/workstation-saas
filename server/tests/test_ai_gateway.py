"""生成网关(app.ai.gateway)的收尾路径:断开、落库失败、长生成的心跳(v1.1 L246–L248)。

对话 / 批量的业务用例在 test_ai_chats.py、test_ai_batch.py;这里只测生命周期边界。"""

import asyncio
import contextlib
import json

import anyio
from sqlalchemy.exc import OperationalError
from structlog.testing import capture_logs

import app.ai.gateway as gw
from app.ai.gateway import reply_events, sse
from app.domain.ai.schemas import AiReplyIn
from tests.helpers import auth
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
