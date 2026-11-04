import asyncio
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.auth.service import get_user
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_token
from app.config import Settings
from app.db import SessionScope

router = APIRouter()

CLOSE_UNAUTHORIZED = 4401


def ws_session_scope(websocket: WebSocket) -> SessionScope:
    factory = sessionmaker(bind=websocket.app.state.engine)

    @contextmanager
    def scope():
        with factory() as s:
            yield s

    return scope


def _authenticate(scope: SessionScope, settings: Settings, token: str) -> UUID | None:
    try:
        user_id = decode_access_token(token, settings)
    except (TokenExpired, TokenInvalid):
        return None
    with scope() as db:
        user = get_user(db, user_id)
        if user is None or user.status != "active" or user.must_change_password:
            return None
    return user_id


async def _handshake(websocket: WebSocket, scope: SessionScope) -> UUID | None:
    try:
        first = await asyncio.wait_for(
            websocket.receive_json(), websocket.app.state.ws_auth_timeout
        )
    except (TimeoutError, WebSocketDisconnect, ValueError):
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
    user_id = await _handshake(websocket, scope)
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return
    hub = websocket.app.state.hub
    hub.register(user_id, websocket)
    try:
        await websocket.send_json({"type": "ready"})
        while True:
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
