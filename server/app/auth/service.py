import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.passwords import verify_password
from app.auth.tokens import issue_access_token
from app.config import Settings
from app.errors import ApiError
from app.models import User


def get_user_by_login(db: Session, school_id: UUID, login_name: str) -> User | None:
    return db.scalar(
        select(User).where(User.school_id == school_id, User.login_name == login_name.strip())
    )


def get_user(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


@dataclass
class LoginResult:
    access_token: str
    refresh_token: str
    expires_at: datetime
    user: User


def _fail_key(settings: Settings, login_name: str) -> str:
    return f"ws:login_fail:{settings.school_id}:{login_name}"


def _refresh_key(refresh_token: str) -> str:
    return f"ws:refresh:{refresh_token}"


def login(
    db: Session, redis: Redis, settings: Settings, login_name: str, password: str
) -> LoginResult:
    login_name = login_name.strip()
    fail_key = _fail_key(settings, login_name)
    failures = int(redis.get(fail_key) or 0)
    if failures >= settings.login_max_failures:
        raise ApiError(429, "ACCOUNT_LOCKED", "登录失败次数过多,请稍后再试")

    user = get_user_by_login(db, settings.school_id, login_name)
    if user is None or user.status != "active" or not verify_password(password, user.password_hash):
        if redis.incr(fail_key) == 1:
            redis.expire(fail_key, settings.login_lock_seconds)
        raise ApiError(401, "INVALID_CREDENTIALS", "登录名或密码不正确")

    redis.delete(fail_key)
    user.last_login_at = datetime.now(UTC)
    db.commit()
    access_token, expires_at = issue_access_token(user.id, settings)
    refresh_token = secrets.token_urlsafe(32)
    redis.set(_refresh_key(refresh_token), str(user.id), ex=settings.refresh_ttl_seconds)
    return LoginResult(access_token, refresh_token, expires_at, user)


def refresh(
    db: Session, redis: Redis, settings: Settings, refresh_token: str
) -> tuple[str, datetime]:
    key = _refresh_key(refresh_token)
    user_id = redis.get(key)
    user = None
    if user_id is not None:
        try:
            user = get_user(db, UUID(user_id))
        except ValueError:
            user = None
    if user is None or user.status != "active":
        redis.delete(key)
        raise ApiError(401, "INVALID_REFRESH", "登录已失效,请重新登录")
    return issue_access_token(user.id, settings)


def logout(redis: Redis, refresh_token: str) -> None:
    redis.delete(_refresh_key(refresh_token))
