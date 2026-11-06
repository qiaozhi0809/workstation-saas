import asyncio
import time
from contextlib import ExitStack, contextmanager
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


def _expect_close(ws, code, limit=10.0):
    end = time.monotonic() + limit
    with pytest.raises(WebSocketDisconnect) as exc:
        while time.monotonic() < end:
            ws.receive_json()  # 跳过 ping 等帧,直到被关闭
        pytest.fail("socket was not closed in time")  # 回归时失败,而不是卡死
    assert exc.value.code == code


def test_stale_closes_with_4401(ws_client, settings, db, redis_client):
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    with ExitStack() as stack:
        ws = _open(stack, ws_client, _token(settings, uid))
        publish(redis_client, [uid], {"type": STALE})
        _expect_close(ws, 4401)


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
    with ExitStack() as stack:
        # 先连上再改密码:改密码之后签发时间早于改密的令牌可能被 HTTP 侧拒绝(段 A 的 R6)
        w1 = _open(stack, ws_client, s1["access_token"])
        w2 = _open(stack, ws_client, s2["access_token"])
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
    elapsed = time.monotonic() - started
    assert 1.0 < elapsed < 4  # 靠 exp 到期才断开:不是一连上就关,也在一个 ping 周期内


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
    def __init__(self, hang: bool = False, close_hang: bool = False) -> None:
        self.hang = hang
        self.close_hang = close_hang
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def send_json(self, event: dict) -> None:
        if self.hang:
            await asyncio.sleep(3600)
        self.sent.append(event)

    async def close(self, code: int = 1000) -> None:
        if self.close_hang:
            await asyncio.sleep(0.5)
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
    assert slow.closed == 4401
    assert slow not in hub._sockets.get(uid, set())


def test_deliver_slow_socket_does_not_block_others(monkeypatch):
    """M5c R8 / L129:一个 socket 发送卡住,别的用户 1 秒内就收到(各 socket 并发)。"""
    monkeypatch.setattr("app.ws.hub.SEND_TIMEOUT", 3.0)
    slow_user, fast_user = UUID(ADMIN), UUID("55555555-5555-5555-5555-555555555547")
    far = datetime.now(UTC) + timedelta(hours=1)
    slow, fast = _FakeSocket(hang=True), _FakeSocket()
    hub = Hub()
    hub.register(slow_user, slow, expires_at=far)
    hub.register(fast_user, fast, expires_at=far)
    event = {"type": "notice.recalled", "id": "n"}
    message = {"user_ids": [str(slow_user), str(fast_user)], "event": event}

    async def scenario() -> None:
        task = asyncio.create_task(hub.deliver(message))
        await asyncio.sleep(1.0)
        assert fast.sent == [event]
        assert not task.done()  # 慢的还在等自己的 3 秒超时
        await asyncio.wait_for(task, 5)

    asyncio.run(scenario())
    assert slow.closed == 4401


def test_stale_closes_concurrently(monkeypatch):
    """session.stale 的关闭也并发:一个 socket 的 close 卡住不拖慢其余。"""
    monkeypatch.setattr("app.ws.hub.SEND_TIMEOUT", 0.5)
    far = datetime.now(UTC) + timedelta(hours=1)
    uids = [UUID(f"55555555-5555-5555-5555-5555555555{n:02d}") for n in range(40, 44)]
    hub = Hub()
    socks = []
    for uid in uids:
        sock = _FakeSocket(close_hang=True)
        socks.append(sock)
        hub.register(uid, sock, expires_at=far)
    message = {"user_ids": [str(u) for u in uids], "event": {"type": STALE}}
    started = time.monotonic()
    asyncio.run(asyncio.wait_for(hub.deliver(message), 5))
    assert time.monotonic() - started < 1.2  # 串行要 4 × 0.5 = 2 秒
    assert not hub._sockets


def test_per_user_socket_cap(ws_client, settings, db, redis_client):
    """第 11 条连接 accept 后以 4429 关闭;已在线的 10 条不受影响。"""
    from app.ws.hub import MAX_SOCKETS_PER_USER

    assert MAX_SOCKETS_PER_USER == 10
    uid = _uid(db, "teacher01")
    hub = ws_client.app.state.hub
    token = _token(settings, uid)
    with ExitStack() as stack:
        online = []
        for _ in range(MAX_SOCKETS_PER_USER):
            ws = stack.enter_context(ws_client.websocket_connect(PATH))
            ws.send_json({"type": "auth", "token": token})
            assert ws.receive_json() == {"type": "ready"}
            online.append(ws)
        extra = stack.enter_context(ws_client.websocket_connect(PATH))
        extra.send_json({"type": "auth", "token": token})
        with pytest.raises(WebSocketDisconnect) as exc:
            extra.receive_json()
        assert exc.value.code == 4429
        assert len(hub._sockets[uid]) == MAX_SOCKETS_PER_USER
        publish(redis_client, [uid], {"type": "notice.recalled", "id": "n"})
        assert online[0].receive_json() == {"type": "notice.recalled", "id": "n"}


# ---- M5b 段 A R5 / B-3:ws 鉴权与 HTTP 同一套判定 ----


def _token_at(settings, user_id, when: datetime) -> str:
    return jwt.encode(
        {"sub": str(user_id), "iat": when, "exp": datetime.now(UTC) + timedelta(seconds=600)},
        settings.jwt_secret,
        algorithm="HS256",
    )


def _assert_rejected(ws_client, token, code=4401):
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": token})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == code


def _set_max_age(db, uid, days):
    from app.domain.school_settings.schemas import SecuritySettings
    from app.domain.school_settings.service import save_security

    user = db.get(User, uid)
    save_security(
        db,
        user.school_id,
        SecuritySettings(totp_allowed=True, password_min_length=8, password_max_age_days=days),
        uid,
    )


def test_ws_rejects_expired_password(ws_client, settings, db):
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    _set_max_age(db, uid, 90)
    user = db.get(User, uid)
    user.password_changed_at = datetime.now(UTC) - timedelta(days=91)
    db.flush()
    _assert_rejected(ws_client, _token(settings, uid))
    user.password_changed_at = datetime.now(UTC) - timedelta(days=10)
    db.flush()
    with ExitStack() as stack:  # 对照:未过期可连
        _open(stack, ws_client, _token(settings, uid))
    user.must_change_password = True
    db.flush()
    _assert_rejected(ws_client, _token(settings, uid))


def test_ws_rejects_token_issued_before_password_change(ws_client, settings, db):
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    db.get(User, uid).password_changed_at = datetime.now(UTC) - timedelta(hours=1)
    db.flush()
    old = _token_at(settings, uid, datetime.now(UTC) - timedelta(seconds=30))
    db.get(User, uid).password_changed_at = datetime.now(UTC) - timedelta(seconds=10)
    db.flush()
    _assert_rejected(ws_client, old)
    with ExitStack() as stack:
        _open(stack, ws_client, _token(settings, uid))


def test_ws_rejects_token_issued_before_totp_enable(ws_client, settings, db):
    from contextlib import ExitStack

    uid = _uid(db, "teacher01")
    user = db.get(User, uid)
    user.password_changed_at = datetime.now(UTC) - timedelta(hours=1)
    old = _token_at(settings, uid, datetime.now(UTC) - timedelta(seconds=30))
    user.totp_secret = "placeholder-not-decrypted"
    user.totp_enabled_at = datetime.now(UTC) - timedelta(seconds=10)
    db.flush()
    _assert_rejected(ws_client, old)
    with ExitStack() as stack:
        _open(stack, ws_client, _token(settings, uid))


def test_ws_recheck_after_register_closes_on_password_change(ws_client, settings, db, monkeypatch):
    uid = _uid(db, "teacher01")
    original = Hub.register

    def register_then_change_password(self, user_id, websocket, **kwargs):
        original(self, user_id, websocket, **kwargs)
        # 鉴权通过之后、register 之后:密码恰好被改(令牌 iat 早于改密时间)
        db.get(User, user_id).password_changed_at = datetime.now(UTC) + timedelta(seconds=5)
        db.flush()

    monkeypatch.setattr(Hub, "register", register_then_change_password)
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        _expect_close(ws, 4401)
    assert uid not in ws_client.app.state.hub._sockets


def test_ws_recheck_after_register_closes_on_expired_or_must_change(
    ws_client, settings, db, monkeypatch
):
    uid = _uid(db, "teacher01")
    original = Hub.register

    def register_then_force_change(self, user_id, websocket, **kwargs):
        original(self, user_id, websocket, **kwargs)
        db.get(User, user_id).must_change_password = True
        db.flush()

    monkeypatch.setattr(Hub, "register", register_then_force_change)
    with ws_client.websocket_connect(PATH) as ws:
        ws.send_json({"type": "auth", "token": _token(settings, uid)})
        _expect_close(ws, 4401)


def test_change_password_publishes_stale_end_to_end(ws_client, settings, db, redis_client):
    from contextlib import ExitStack

    other = _uid(db, "teacher02")
    s1 = _login(ws_client)
    with ExitStack() as stack:
        w1 = _open(stack, ws_client, s1["access_token"])
        wo = _open(stack, ws_client, _token(settings, other))
        res = ws_client.post(
            "/api/v1/auth/password",
            headers={"Authorization": f"Bearer {s1['access_token']}"},
            json={
                "old_password": "dev123",
                "new_password": "Newpass-9x",
                "refresh_token": s1["refresh_token"],
            },
        )
        assert res.status_code == 200
        _expect_close(w1, 4401)  # 没有手动 publish:事件由改密码本身发布
        publish(redis_client, [other], {"type": "notice.recalled", "id": "other-ok"})
        assert wo.receive_json() == {"type": "notice.recalled", "id": "other-ok"}
