import time
from contextlib import contextmanager
from datetime import timedelta
from uuid import UUID

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app import clock
from app.models import User
from app.ws.hub import publish
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
        redis_client.execute_command("CLIENT", "KILL", "TYPE", "pubsub")  # 订阅连接被服务端踢掉
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
