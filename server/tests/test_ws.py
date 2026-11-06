import asyncio
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app import clock
from app.models import User
from app.ws.hub import STALE, Hub, publish
from app.ws.router import ws_session_scope
from tests.helpers import auth

ADMIN = "55555555-5555-5555-5555-555555555546"
PATH = "/api/v1/ws"


def _token(settings, user_id) -> str:
    return auth(settings, user_id)["Authorization"].removeprefix("Bearer ")


@pytest.fixture
def ws_client(client, db, redis_client):
    """真 Redis 的 ws 客户端:进入 with 才会触发 lifespan(订阅任务)。"""

    @contextmanager
    def scope():
        yield db

    client.app.dependency_overrides[ws_session_scope] = lambda: scope
    client.app.state.ws_auth_timeout = 0.2
    with TestClient(client.app) as c:
        yield c


def _uid(db, login) -> UUID:
    return db.scalars(select(User.id).where(User.login_name == login)).one()


def test_auth_then_receive(ws_client, settings, db, redis_client):
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        assert ws.receive_json() == {"type": "ready"}
        event = {"type": "notice.new", "id": "n1", "title": "t", "from_name": "f"}
        publish(redis_client, [uid], event)
        assert ws.receive_json() == event


def test_unauthenticated_socket_gets_nothing(ws_client, settings, db, redis_client):
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        publish(redis_client, [uid], {"type": "notice.new", "id": "x"})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_bad_token_closed(ws_client, settings, db):
    uid = _uid(db, "teacher01")
    past = clock.utc_now() - timedelta(hours=2)
    expired = jwt.encode(
        {"sub": str(uid), "iat": past, "exp": past + timedelta(minutes=1)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    for bad in ("garbage", expired):
        with ws_client.websocket_connect(PATH) as ws:
            ws.send_json({"type": "auth", "token": bad})
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4401

    db.get(User, uid).must_change_password = True
    db.flush()
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_events_only_to_target_users(ws_client, settings, db, redis_client):
    a, b = _uid(db, "teacher01"), _uid(db, "teacher02")
    with ws_client.websocket_connect(PATH) as wa, ws_client.websocket_connect(PATH) as wb:
        for ws, uid in ((wa, a), (wb, b)):
            ws.send_json({"type": "auth", "token": _token(settings, uid)})
            assert ws.receive_json() == {"type": "ready"}
        publish(redis_client, [a], {"type": "notice.recalled", "id": "n1"})
        assert wa.receive_json() == {"type": "notice.recalled", "id": "n1"}
        publish(redis_client, [b], {"type": "notice.recalled", "id": "n2"})
        assert wb.receive_json() == {"type": "notice.recalled", "id": "n2"}


def test_frozen_user_socket_closed(ws_client, settings, db):
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        assert ws.receive_json() == {"type": "ready"}
        res = ws_client.post(f"/api/v1/admin/accounts/{uid}/freeze", headers=auth(settings, ADMIN))
        assert res.status_code == 200
        assert ws.receive_json() == {"type": "session.revoked"}
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4403


def _wait(cond, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_subscriber_reconnects_after_redis_error(ws_client, settings, db, redis_client):
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        assert ws.receive_json() == {"type": "ready"}
        # 只踢本测试 hub 的订阅连接(按 CLIENT SETNAME 过滤),不碰共享 Redis 上别的订阅
        name = ws_client.app.state.hub.client_name
        victims = [c for c in redis_client.client_list(_type="pubsub") if c.get("name") == name]
        assert victims
        for c in victims:
            redis_client.client_kill_filter(_id=c["id"])
        assert _wait(lambda: redis_client.pubsub_numsub("ws:events")[0][1] == 1)
        publish(redis_client, [uid], {"type": "notice.recalled", "id": "after"})
        assert ws.receive_json() == {"type": "notice.recalled", "id": "after"}


def test_ping_sent(ws_client, settings, db):
    ws_client.app.state.ws_ping_interval = 0.1
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        assert ws.receive_json() == {"type": "ready"}
        assert ws.receive_json() == {"type": "ping"}


def test_frozen_user_rejected_at_auth(ws_client, settings, db):
    uid = _uid(db, "teacher01")
    token = _token(settings, uid)
    db.get(User, uid).status = "frozen"
    db.flush()
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": token})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_non_json_first_frame_closed(ws_client):
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_bytes(b"\xff\x00")
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_text("not json")
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_messages_after_auth_ignored(ws_client, settings, db, redis_client):
    uid = _uid(db, "teacher01")
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        assert ws.receive_json() == {"type": "ready"}
        ws.send_json({"type": "auth", "token": "x"})
        ws.send_text("junk")
        publish(redis_client, [uid], {"type": "notice.recalled", "id": "n"})
        assert ws.receive_json() == {"type": "notice.recalled", "id": "n"}


def test_two_sockets_of_one_user_and_unregister(ws_client, settings, db, redis_client):
    uid = _uid(db, "teacher01")
    hub = ws_client.app.state.hub
    with ws_client.websocket_connect(PATH) as w1, ws_client.websocket_connect(PATH) as w2:
        for ws in (w1, w2):
            ws.send_json({"type": "auth", "token": _token(settings, uid)})
            assert ws.receive_json() == {"type": "ready"}
        publish(redis_client, [uid], {"type": "notice.recalled", "id": "n"})
        assert w1.receive_json() == w2.receive_json() == {"type": "notice.recalled", "id": "n"}
        assert len(hub._sockets[uid]) == 2
    assert _wait(lambda: uid not in hub._sockets)


def test_publish_is_best_effort_on_redis_error(redis_client, monkeypatch, caplog):
    from redis.exceptions import ConnectionError as RedisConnectionError

    def boom(*args, **kwargs):
        raise RedisConnectionError("secret-detail")

    monkeypatch.setattr(redis_client, "publish", boom)
    with caplog.at_level("WARNING"):
        result = publish(redis_client, [UUID(ADMIN)], {"type": "notice.new"})
    assert result is None
    assert "ConnectionError" in caplog.text
    assert "secret-detail" not in caplog.text
    assert ADMIN not in caplog.text


def test_publish_swallows_unserializable_event(redis_client):
    from datetime import datetime

    assert publish(redis_client, [UUID(ADMIN)], {"type": "x", "at": datetime(2026, 1, 1)}) is None


def _open(stack, ws_client, token):
    ws = stack.enter_context(ws_client.websocket_connect(PATH))
    ws.send_json({"type": "auth", "token": token})
    assert ws.receive_json() == {"type": "ready"}
    return ws


def _expect_close(ws, code):
    with pytest.raises(WebSocketDisconnect) as exc:
        while True:
            ws.receive_json()  # 跳过 ping 等帧,直到被关闭
    assert exc.value.code == code


def test_stale_closes_with_4401(ws_client, settings, db, redis_client):
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    with ExitStack() as stack:
        ws = _open(stack, ws_client, _token(settings, uid))
        publish(redis_client, [uid], {"type": STALE})
        _expect_close(ws, 4401)
    assert STALE == "session.stale"


def test_reset_publishes_stale_for_target_only(ws_client, settings, db, redis_client):
    from contextlib import ExitStack

    a, b = _uid(db, "teacher01"), _uid(db, "teacher02")
    with ExitStack() as stack:
        wa = _open(stack, ws_client, _token(settings, a))
        wb = _open(stack, ws_client, _token(settings, b))
        publish(redis_client, [a], {"type": STALE})
        _expect_close(wa, 4401)
        # B 没被关:之后仍能收到发给自己的事件(而不是 stale 的残影)
        publish(redis_client, [b], {"type": "notice.recalled", "id": "still-here"})
        assert wb.receive_json() == {"type": "notice.recalled", "id": "still-here"}


def _login(client, name="teacher01", pw="dev123"):
    res = client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})
    assert res.status_code == 200
    return res.json()


def test_change_password_keeps_own_session(ws_client, settings, db, redis_client):
    """真实 HTTP 改密码撤销 S2 的刷新令牌;`session.stale` 由段 A 的 Task 3 在改密码里发布,
    此处由测试自己 publish(A 合并后由 test_change_password_publishes_stale 补端到端)。"""
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    s1, s2 = _login(ws_client), _login(ws_client)
    new_pw = "Newpass-9x"
    res = ws_client.post(
        "/api/v1/auth/password",
        headers={"Authorization": f"Bearer {s1['access_token']}"},
        json={
            "old_password": "dev123",
            "new_password": new_pw,
            "refresh_token": s1["refresh_token"],
        },
    )
    assert res.status_code == 200
    with ExitStack() as stack:
        w1 = _open(stack, ws_client, s1["access_token"])
        w2 = _open(stack, ws_client, s2["access_token"])
        publish(redis_client, [uid], {"type": STALE})
        _expect_close(w1, 4401)
        _expect_close(w2, 4401)
    r1 = ws_client.post("/api/v1/auth/refresh", json={"refresh_token": s1["refresh_token"]})
    assert r1.status_code == 200
    r2 = ws_client.post("/api/v1/auth/refresh", json={"refresh_token": s2["refresh_token"]})
    assert r2.status_code == 401
    with ExitStack() as stack:  # S1 用刷新出的新令牌重连成功
        _open(stack, ws_client, r1.json()["access_token"])


def test_expired_token_socket_closed(ws_client, settings, db):
    from contextlib import ExitStack

    settings.access_ttl_seconds = 2
    ws_client.app.state.ws_ping_interval = 0.5
    uid = _uid(db, "teacher01")
    started = time.monotonic()
    with ExitStack() as stack:
        ws = _open(stack, ws_client, _token(settings, uid))
        _expect_close(ws, 4401)
    assert time.monotonic() - started < 4  # 令牌过期后一个 ping 周期内断开


def test_status_recheck_after_register(ws_client, settings, db, monkeypatch):
    uid = _uid(db, "teacher01")
    original = Hub.register

    def register_then_freeze(self, user_id, websocket, **kwargs):
        original(self, user_id, websocket, **kwargs)
        db.get(User, user_id).status = "frozen"  # 握手窗口内账号被冻结
        db.flush()

    monkeypatch.setattr(Hub, "register", register_then_freeze)
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        _expect_close(ws, 4403)
    assert uid not in ws_client.app.state.hub._sockets


class _FakeSocket:
    def __init__(self, hang: bool = False) -> None:
        self.hang = hang
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def send_json(self, event: dict) -> None:
        if self.hang:
            await asyncio.sleep(3600)
        self.sent.append(event)

    async def close(self, code: int = 1000) -> None:
        self.closed = code


def test_deliver_timeout(monkeypatch):
    monkeypatch.setattr("app.ws.hub.SEND_TIMEOUT", 0.1)
    uid = UUID(ADMIN)
    far = datetime.now(UTC) + timedelta(hours=1)
    slow, fast = _FakeSocket(hang=True), _FakeSocket()
    hub = Hub()
    hub.register(uid, slow, expires_at=far)
    hub.register(uid, fast, expires_at=far)
    event = {"type": "notice.recalled", "id": "n"}
    asyncio.run(asyncio.wait_for(hub.deliver({"user_ids": [str(uid)], "event": event}), 2))
    assert fast.sent == [event]
    assert slow.closed is not None
    assert slow not in hub._sockets.get(uid, set())
