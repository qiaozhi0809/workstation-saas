"""生成网关(app.ai.gateway)的收尾路径:断开、落库失败、长生成的心跳(v1.1 L246–L248)。

对话 / 批量的业务用例在 test_ai_chats.py、test_ai_batch.py;这里只测生命周期边界。"""

import anyio

from tests.helpers import auth
from tests.test_ai_chats import (
    CHATS,
    _asgi_scope,
    configure_ai,
    create,
    generate_audits,
    get_chat,
    lesson_body,
    set_transport,
)


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
