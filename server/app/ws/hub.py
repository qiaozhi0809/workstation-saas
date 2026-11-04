import asyncio
import json
import logging
from collections.abc import Iterable
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


def publish(redis: Redis, user_ids: Iterable[UUID], event: dict) -> None:
    """业务代码在事务提交之后调用。"""
    redis.publish(CHANNEL, json.dumps({"user_ids": [str(u) for u in user_ids], "event": event}))


class Hub:
    def __init__(self) -> None:
        self._sockets: dict[UUID, set[WebSocket]] = {}
        self.subscribed = asyncio.Event()
        self._retry_delay = RETRY_MIN

    def register(self, user_id: UUID, websocket: WebSocket) -> None:
        self._sockets.setdefault(user_id, set()).add(websocket)

    def unregister(self, user_id: UUID, websocket: WebSocket) -> None:
        sockets = self._sockets.get(user_id)
        if sockets:
            sockets.discard(websocket)
            if not sockets:
                del self._sockets[user_id]

    async def deliver(self, message: dict) -> None:
        event = message["event"]
        revoked = event.get("type") == REVOKED
        for raw in message["user_ids"]:
            user_id = UUID(raw)
            for ws in list(self._sockets.get(user_id, ())):
                try:
                    await ws.send_json(event)
                except Exception as exc:
                    log.warning("ws send failed: %s", type(exc).__name__)
                if revoked:
                    try:
                        await ws.close(code=CLOSE_REVOKED)
                    except Exception as exc:
                        log.warning("ws close failed: %s", type(exc).__name__)
                    self.unregister(user_id, ws)

    async def _subscribe_and_dispatch(self, redis_url: str) -> None:
        client = AsyncRedis.from_url(redis_url, decode_responses=True)
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
            await pubsub.aclose()
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
