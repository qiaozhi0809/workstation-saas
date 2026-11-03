import secrets
from uuid import UUID

from redis import Redis

from app.config import Settings


def refresh_key(token: str) -> str:
    return f"ws:refresh:{token}"


def _user_set_key(user_id: UUID | str) -> str:
    return f"ws:user_refresh:{user_id}"


def issue_refresh(redis: Redis, settings: Settings, user_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    set_key = _user_set_key(user_id)
    pipe = redis.pipeline()
    pipe.set(refresh_key(token), str(user_id), ex=settings.refresh_ttl_seconds)
    pipe.sadd(set_key, token)
    pipe.expire(set_key, settings.refresh_ttl_seconds)
    pipe.execute()
    return token


def revoke_refresh(redis: Redis, token: str) -> None:
    key = refresh_key(token)
    user_id = redis.get(key)
    pipe = redis.pipeline()
    pipe.delete(key)
    if user_id is not None:
        pipe.srem(_user_set_key(user_id), token)
    pipe.execute()


def revoke_all(redis: Redis, user_id: UUID, *, keep: str | None = None) -> int:
    """作废除 keep 外的全部刷新令牌,返回真正存活被删掉的个数;过期残留成员一并清出集合。"""
    set_key = _user_set_key(user_id)
    members = [t for t in redis.smembers(set_key) if t != keep]
    if not members:
        return 0
    pipe = redis.pipeline()
    for t in members:
        pipe.delete(refresh_key(t))
    pipe.srem(set_key, *members)
    results = pipe.execute()
    return sum(results[:-1])
