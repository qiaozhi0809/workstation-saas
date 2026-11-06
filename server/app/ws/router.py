import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, WebSocket
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.auth.service import get_user
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_token
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


def _authenticate(
    scope: SessionScope, settings: Settings, token: str
) -> tuple[UUID, datetime] | None:
    try:
        user_id = decode_access_token(token, settings)
        # 签名与过期已由上一行校验;这里只取 exp 作为 socket 的存活期限
        exp = jwt.decode(token, options={"verify_signature": False})["exp"]
        expires_at = datetime.fromtimestamp(exp, UTC)
    except (TokenExpired, TokenInvalid, jwt.PyJWTError, KeyError, TypeError, ValueError, OSError):
        return None
    with scope() as db:
        user = get_user(db, user_id)
        if user is None or user.status != "active" or user.must_change_password:
            return None
    return user_id, expires_at


def _still_active(scope: SessionScope, user_id: UUID) -> bool:
    with scope() as db:
        user = get_user(db, user_id)
        return user is not None and user.status == "active"


async def _handshake(websocket: WebSocket, scope: SessionScope) -> tuple[UUID, datetime] | None:
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
    user_id, expires_at = authed
    hub = websocket.app.state.hub
    hub.register(user_id, websocket, expires_at=expires_at)
    try:
        # L28:鉴权与 register 之间账号可能已被冻结 / 归档(revoked 事件无人接收),再查一次
        if not await run_in_threadpool(_still_active, scope, user_id):
            await websocket.close(code=CLOSE_REVOKED)
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
