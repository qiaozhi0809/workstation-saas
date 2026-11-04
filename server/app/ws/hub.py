import asyncio
import json
from collections.abc import Iterable
from uuid import UUID

from fastapi import WebSocket
from redis import Redis
from redis.asyncio import Redis as AsyncRedis

CHANNEL = "ws:events"
REVOKED = "session.revoked"
CLOSE_REVOKED = 4403


def publish(redis: Redis, user_ids: Iterable[UUID], event: dict) -> None:
    """业务代码在事务提交之后调用。"""
    redis.publish(CHANNEL, json.dumps({"user_ids": [str(u) for u in user_ids], "event": event}))


class Hub:
    def __init__(self) -> None:
        self._sockets: dict[UUID, set[WebSocket]] = {}
        self.subscribed = asyncio.Event()

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
                    if revoked:
                        await ws.close(code=CLOSE_REVOKED)
                except Exception:
                    pass
                if revoked:
                    self.unregister(user_id, ws)

    async def run(self, redis_url: str) -> None:
        client = AsyncRedis.from_url(redis_url, decode_responses=True)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(CHANNEL)
            self.subscribed.set()
            async for item in pubsub.listen():
                if item["type"] != "message":
                    continue
                try:
                    message = json.loads(item["data"])
                    await self.deliver(message)
                except Exception:
                    continue
        finally:
            await pubsub.aclose()
            await client.aclose()
