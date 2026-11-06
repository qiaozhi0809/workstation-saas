from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import clock
from app.auth.service import can_use_api, get_user, token_is_current
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_claims
from app.config import Settings, settings_dep
from app.db import get_db
from app.errors import ApiError
from app.models import User

_bearer = HTTPBearer(auto_error=False)


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
    if not token_is_current(user, claims["iat"]):
        raise ApiError(401, "TOKEN_EXPIRED", "登录已过期")
    return user


def get_current_user(
    user: Annotated[User, Depends(get_current_user_pending)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if not can_use_api(db, user, clock.utc_now()):
        raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码")
    return user
