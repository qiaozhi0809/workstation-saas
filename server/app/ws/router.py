import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app import clock
from app.auth.service import can_use_api, get_user, token_is_current
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_claims
from app.config import Settings
from app.db import SessionScope
from app.ws.hub import CLOSE_REVOKED

router = APIRouter()

CLOSE_UNAUTHORIZED = 4401


def ws_session_scope(websocket: WebSocket) -> SessionScope:
    factory = sessionmaker(bind=websocket.app.state.engine)

    @contextmanager
    def scope():
        with factory() as s:
            yield s

    return scope


def _auth_failure(db, user, iat: int) -> int | None:
    """与 HTTP 同一套判定;返回应关闭的码,None 表示放行。
    冻结 / 归档 -> 4403(不可重连);令牌过期(改密 / 重置 / 开 2FA)或需改密码 -> 4401(刷新后重连)。"""
    if user is None or user.status != "active":
        return CLOSE_REVOKED
    if not token_is_current(user, iat) or not can_use_api(db, user, clock.utc_now()):
        return CLOSE_UNAUTHORIZED
    return None


def _authenticate(
    scope: SessionScope, settings: Settings, token: str
) -> tuple[UUID, datetime, int] | None:
    try:
        claims = decode_access_claims(token, settings)
        expires_at = datetime.fromtimestamp(claims["exp"], UTC)
    except (TokenExpired, TokenInvalid, ValueError, OSError, OverflowError):
        return None
    user_id, iat = claims["sub"], claims["iat"]
    with scope() as db:
        if _auth_failure(db, get_user(db, user_id), iat) is not None:
            return None
    return user_id, expires_at, iat


def _recheck(scope: SessionScope, user_id: UUID, iat: int) -> int | None:
    with scope() as db:
        return _auth_failure(db, get_user(db, user_id), iat)


async def _handshake(
    websocket: WebSocket, scope: SessionScope
) -> tuple[UUID, datetime, int] | None:
    try:
        first = await asyncio.wait_for(
            websocket.receive_json(), websocket.app.state.ws_auth_timeout
        )
    except Exception:
        return None
    if not isinstance(first, dict) or first.get("type") != "auth":
        return None
    token = first.get("token")
    if not isinstance(token, str):
        return None
    return await run_in_threadpool(_authenticate, scope, websocket.app.state.settings, token)


@router.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket, scope: Annotated[SessionScope, Depends(ws_session_scope)]
) -> None:
    await websocket.accept()
    authed = await _handshake(websocket, scope)
    if authed is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return
    user_id, expires_at, iat = authed
    hub = websocket.app.state.hub
    hub.register(user_id, websocket, expires_at=expires_at)
    try:
        # L28 / B-3:鉴权与 register 之间账号可能已被冻结 / 归档,或密码已被改 / 重置
        # (revoked / stale 事件无人接收),按同一套判定再查一次
        failure = await run_in_threadpool(_recheck, scope, user_id, iat)
        if failure is not None:
            await websocket.close(code=failure)
            return
        await websocket.send_json({"type": "ready"})
        while True:
            # L29:令牌到期即断开,客户端用刷新令牌换新令牌后重连
            if hub.is_expired(websocket, datetime.now(UTC)):
                await websocket.close(code=CLOSE_UNAUTHORIZED)
                return
            try:
                msg = await asyncio.wait_for(
                    websocket.receive(), websocket.app.state.ws_ping_interval
                )
            except TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue
            if msg["type"] == "websocket.disconnect":
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.unregister(user_id, websocket)
