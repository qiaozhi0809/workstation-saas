"""ws Hub 的过期判定(L130):失败即关——没登记过期时间的连接按已过期算;握手里的 exp 溢出直接拒绝。"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt

from app.ws.hub import Hub
from app.ws.router import _authenticate

NOW = datetime(2026, 11, 9, 1, 0, tzinfo=UTC)


def test_unknown_socket_treated_expired():
    hub = Hub()
    uid, ws = uuid4(), object()
    assert hub.is_expired(ws, NOW) is True  # 从未登记
    hub.register(uid, ws, expires_at=NOW + timedelta(minutes=5))
    assert hub.is_expired(ws, NOW) is False
    assert hub.is_expired(ws, NOW + timedelta(minutes=5)) is True
    hub.unregister(uid, ws)
    assert hub.is_expired(ws, NOW) is True  # 注销后不再有过期时间 → 仍按过期


def test_overflow_timestamp_rejected(settings):
    """exp 大到 fromtimestamp 都装不下(OverflowError / ValueError / OSError 任一)→ 握手失败,
    不会带着一个"永不过期"的连接进 Hub。鉴权在解码阶段就返回,不会碰数据库。"""
    now = int(NOW.timestamp())
    token = jwt.encode(
        {"sub": str(uuid4()), "iat": now, "exp": 10**20},
        settings.jwt_secret,
        algorithm="HS256",
    )

    def scope():
        raise AssertionError("exp 溢出时不应再查库")

    assert _authenticate(scope, settings, token) is None
