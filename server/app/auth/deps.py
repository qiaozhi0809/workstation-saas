from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import clock
from app.auth.service import can_use_api, get_user
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_claims
from app.config import Settings, settings_dep
from app.db import get_db
from app.errors import ApiError
from app.models import User

_bearer = HTTPBearer(auto_error=False)


def _whole_seconds(moment: datetime) -> int:
    """库里是 timestamptz(带时区),clock.utc_now() 也带时区;统一成 UTC 的整秒再比较。"""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return int(moment.timestamp())


def _issued_before_credential_change(user: User, iat: int) -> bool:
    """令牌签发于密码修改 / 开启两步验证之前(取整到秒:同一秒内签发的放行)。"""
    changed = [user.password_changed_at]
    if user.totp_enabled_at is not None:
        changed.append(user.totp_enabled_at)
    return iat < max(_whole_seconds(m) for m in changed)


def get_current_user_pending(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> User:
    if credentials is None:
        raise ApiError(401, "UNAUTHORIZED", "未登录")
    try:
        claims = decode_access_claims(credentials.credentials, settings)
    except TokenExpired:
        raise ApiError(401, "TOKEN_EXPIRED", "登录已过期") from None
    except TokenInvalid:
        raise ApiError(401, "UNAUTHORIZED", "登录凭证无效") from None
    user = get_user(db, claims["sub"])
    if user is None or user.status != "active":
        raise ApiError(401, "UNAUTHORIZED", "登录凭证无效")
    if _issued_before_credential_change(user, claims["iat"]):
        raise ApiError(401, "TOKEN_EXPIRED", "登录已过期")
    return user


def get_current_user(
    user: Annotated[User, Depends(get_current_user_pending)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if not can_use_api(db, user, clock.utc_now()):
        raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码")
    return user
