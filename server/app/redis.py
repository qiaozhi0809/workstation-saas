from fastapi import Request
from redis import Redis


def get_redis(request: Request) -> Redis:
    return request.app.state.redis
