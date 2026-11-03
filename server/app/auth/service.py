from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import record
from app.auth import sessions
from app.auth.passwords import check_policy, hash_password, verify_password
from app.auth.tokens import issue_access_token
from app.config import Settings
from app.domain.schools.service import active_academic_year
from app.errors import ApiError
from app.models import User
from app.rbac.admin import admin_perms
from app.rbac.bindings import Binding, load_bindings
from app.rbac.roles import ADMIN_ROLES, TEACHER_ROLES


class UserBrief(BaseModel):
    id: UUID
    display_name: str
    contexts: list[str]
    admin_perms: list[str]
    must_change_password: bool


def contexts_of(bindings: list[Binding]) -> list[str]:
    result = []
    if any(bd.role in TEACHER_ROLES for bd in bindings):
        result.append("teacher")
    if any(bd.role in ADMIN_ROLES for bd in bindings):
        result.append("admin")
    return result


def user_brief(db: Session, user: User) -> UserBrief:
    year = active_academic_year(db, user.school_id)
    bindings = load_bindings(db, user.id, year.id if year else None)
    return UserBrief(
        id=user.id,
        display_name=user.display_name,
        contexts=contexts_of(bindings),
        admin_perms=admin_perms(bindings),
        must_change_password=user.must_change_password,
    )


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
        failures = redis.incr(fail_key)
        if failures == 1 or failures == settings.login_max_failures:
            # 首次失败开计数窗口;达到上限时重新计时,保证锁定满整个窗口
            redis.expire(fail_key, settings.login_lock_seconds)
        raise ApiError(401, "INVALID_CREDENTIALS", "登录名或密码不正确")

    redis.delete(fail_key)
    user.last_login_at = clock.utc_now()
    db.commit()
    access_token, expires_at = issue_access_token(user.id, settings)
    refresh_token = sessions.issue_refresh(redis, settings, user.id)
    return LoginResult(access_token, refresh_token, expires_at, user)


def refresh(
    db: Session, redis: Redis, settings: Settings, refresh_token: str
) -> tuple[str, datetime]:
    key = sessions.refresh_key(refresh_token)
    user_id = redis.get(key)
    user = None
    if user_id is not None:
        try:
            user = get_user(db, UUID(user_id))
        except ValueError:
            user = None
    if user is None or user.status != "active":
        sessions.revoke_refresh(redis, refresh_token)
        raise ApiError(401, "INVALID_REFRESH", "登录已失效,请重新登录")
    return issue_access_token(user.id, settings)


def logout(redis: Redis, refresh_token: str) -> None:
    sessions.revoke_refresh(redis, refresh_token)


def change_password(
    db: Session,
    redis: Redis,
    settings: Settings,
    user: User,
    old: str,
    new: str,
    keep_token: str,
    request: Request | None = None,
) -> None:
    if not verify_password(old, user.password_hash):
        raise ApiError(400, "WRONG_PASSWORD", "旧密码不正确")
    check_policy(new, old=old)
    user.password_hash = hash_password(new)
    user.must_change_password = False
    record(
        db,
        user_id=user.id,
        action="account.password_change",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    sessions.revoke_all(redis, user.id, keep=keep_token)
