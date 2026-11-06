import json
import secrets
from uuid import UUID

from redis import Redis

CHALLENGE_TTL = 300
MAX_TRIES = 5


def _key(token: str) -> str:
    return f"ws:mfa:{token}"


# 读-改-写放进 Lua,避免并发请求各自读到旧的 tries
_RECORD_TRY = """
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local d = cjson.decode(raw)
d['tries'] = d['tries'] + 1
if d['tries'] >= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(d), 'KEEPTTL')
end
return d['tries']
"""


def issue_challenge(redis: Redis, user_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    redis.set(_key(token), json.dumps({"user_id": str(user_id), "tries": 0}), ex=CHALLENGE_TTL)
    return token


def _user_of(raw: str | None) -> UUID | None:
    if raw is None:
        return None
    try:
        return UUID(json.loads(raw)["user_id"])
    except (ValueError, KeyError, TypeError):
        return None


def peek(redis: Redis, token: str) -> UUID | None:
    """只看不删:第二步要先知道是谁,才能判断锁定与账号状态。"""
    return _user_of(redis.get(_key(token)))


def consume(redis: Redis, token: str) -> UUID | None:
    """取出并删除(GETDEL 原子),一次性。"""
    return _user_of(redis.getdel(_key(token)))


def record_try(redis: Redis, token: str) -> int:
    """记一次错码;累计到 MAX_TRIES 次删除该 token。token 已不存在返回 0。"""
    return int(redis.eval(_RECORD_TRY, 1, _key(token), MAX_TRIES))
