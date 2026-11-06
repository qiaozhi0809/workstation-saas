import asyncio
import json
import logging
import uuid
from collections.abc import Iterable
from datetime import datetime
from uuid import UUID

from fastapi import WebSocket
from redis import Redis
from redis.asyncio import Redis as AsyncRedis

log = logging.getLogger(__name__)

CHANNEL = "ws:events"
RETRY_MIN = 0.1
RETRY_MAX = 5.0
REVOKED = "session.revoked"
CLOSE_REVOKED = 4403
STALE = "session.stale"
CLOSE_STALE = 4401  # 与 router.CLOSE_UNAUTHORIZED 同值:客户端走"刷新后重连"
CLOSE_TOO_MANY = 4429  # 每用户连接数超限;前端按"非令牌原因的断线"退避重连
MAX_SOCKETS_PER_USER = 10  # 按 uvicorn 进程计;WS_WORKERS=2 时每用户最多 20 条
SEND_TIMEOUT = 5.0  # 单个 socket 发送超时,慢客户端不能拖住别人


def publish(redis: Redis, user_ids: Iterable[UUID], event: dict) -> None:
    """尽力而为:业务代码仍须在事务提交之后调用;序列化或 Redis 出错只记警告,绝不抛出。"""
    try:
        redis.publish(CHANNEL, json.dumps({"user_ids": [str(u) for u in user_ids], "event": event}))
    except Exception as exc:
        log.warning("ws publish failed: %s", type(exc).__name__)


class Hub:
    def __init__(self) -> None:
        self._sockets: dict[UUID, set[WebSocket]] = {}
        self._expires: dict[WebSocket, datetime] = {}
        self.subscribed = asyncio.Event()
        self._retry_delay = RETRY_MIN
        self.client_name = f"ws-hub-{uuid.uuid4().hex[:8]}"  # CLIENT SETNAME,便于按名过滤

    def register(self, user_id: UUID, websocket: WebSocket, *, expires_at: datetime) -> None:
        self._sockets.setdefault(user_id, set()).add(websocket)
        self._expires[websocket] = expires_at

    def socket_count(self, user_id: UUID) -> int:
        return len(self._sockets.get(user_id, ()))

    def unregister(self, user_id: UUID, websocket: WebSocket) -> None:
        self._expires.pop(websocket, None)
        sockets = self._sockets.get(user_id)
        if sockets:
            sockets.discard(websocket)
            if not sockets:
                del self._sockets[user_id]

    def is_expired(self, websocket: WebSocket, now: datetime) -> bool:
        expires_at = self._expires.get(websocket)
        return expires_at is not None and now >= expires_at

    async def _close(self, user_id: UUID, ws: WebSocket, code: int) -> None:
        try:
            await asyncio.wait_for(ws.close(code=code), SEND_TIMEOUT)
        except Exception as exc:
            log.warning("ws close failed: %s", type(exc).__name__)
        self.unregister(user_id, ws)

    async def _deliver_one(
        self, user_id: UUID, ws: WebSocket, event: dict, kind: str | None
    ) -> None:
        if kind == STALE:  # 只关闭,不把事件本身推给客户端
            await self._close(user_id, ws, CLOSE_STALE)
            return
        try:
            await asyncio.wait_for(ws.send_json(event), SEND_TIMEOUT)
        except Exception as exc:
            log.warning("ws send failed: %s", type(exc).__name__)
            # 慢 / 死连接:冻结事件仍用 4403,其余让客户端重连
            await self._close(user_id, ws, CLOSE_REVOKED if kind == REVOKED else CLOSE_STALE)
            return
        if kind == REVOKED:
            await self._close(user_id, ws, CLOSE_REVOKED)

    async def deliver(self, message: dict) -> None:
        """同一条消息的各 socket 并发投递(各自 5 秒超时),消息之间仍由调用方按顺序等待。"""
        event = message["event"]
        kind = event.get("type")
        jobs = [
            self._deliver_one(UUID(raw), ws, event, kind)
            for raw in dict.fromkeys(message["user_ids"])  # 去重:同一 socket 不会被并发发两次
            for ws in list(self._sockets.get(UUID(raw), ()))
        ]
        await asyncio.gather(*jobs)

    async def _subscribe_and_dispatch(self, redis_url: str) -> None:
        client = AsyncRedis.from_url(redis_url, decode_responses=True, client_name=self.client_name)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(CHANNEL)
            self.subscribed.set()
            self._retry_delay = RETRY_MIN
            async for item in pubsub.listen():
                if item["type"] != "message":
                    continue
                try:
                    await self.deliver(json.loads(item["data"]))
                except Exception as exc:
                    log.warning("ws dispatch failed: %s", type(exc).__name__)
        finally:
            self.subscribed.clear()
            try:
                await pubsub.aclose()
            finally:
                await client.aclose()

    async def run(self, redis_url: str) -> None:
        """订阅频道直到被取消;Redis 出错时退避重连。"""
        while True:
            try:
                await self._subscribe_and_dispatch(redis_url)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("ws subscriber failed: %s", type(exc).__name__)
            await asyncio.sleep(self._retry_delay)
            self._retry_delay = min(self._retry_delay * 2, RETRY_MAX)
