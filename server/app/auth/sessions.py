import secrets
from uuid import UUID

from redis import Redis

from app.config import Settings


def _refresh_key(token: str) -> str:
    return f"ws:refresh:{token}"


def _user_set_key(user_id: UUID | str) -> str:
    return f"ws:user_refresh:{user_id}"


def issue_refresh(redis: Redis, settings: Settings, user_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    set_key = _user_set_key(user_id)
    pipe = redis.pipeline()
    pipe.set(_refresh_key(token), str(user_id), ex=settings.refresh_ttl_seconds)
    pipe.sadd(set_key, token)
    pipe.expire(set_key, settings.refresh_ttl_seconds)
    pipe.execute()
    return token


def revoke_refresh(redis: Redis, token: str) -> None:
    key = _refresh_key(token)
    user_id = redis.get(key)
    pipe = redis.pipeline()
    pipe.delete(key)
    if user_id is not None:
        pipe.srem(_user_set_key(user_id), token)
    pipe.execute()


def revoke_all(redis: Redis, user_id: UUID, *, keep: str | None = None) -> int:
    set_key = _user_set_key(user_id)
    doomed = [t for t in redis.smembers(set_key) if t != keep]
    if not doomed:
        return 0
    pipe = redis.pipeline()
    pipe.delete(*[_refresh_key(t) for t in doomed])
    pipe.srem(set_key, *doomed)
    pipe.execute()
    return len(doomed)
