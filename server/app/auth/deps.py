from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.service import get_user
from app.auth.tokens import TokenExpired, TokenInvalid, decode_access_token
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
        user_id = decode_access_token(credentials.credentials, settings)
    except TokenExpired:
        raise ApiError(401, "TOKEN_EXPIRED", "登录已过期") from None
    except TokenInvalid:
        raise ApiError(401, "UNAUTHORIZED", "登录凭证无效") from None
    user = get_user(db, user_id)
    if user is None or user.status != "active":
        raise ApiError(401, "UNAUTHORIZED", "登录凭证无效")
    return user


def get_current_user(user: Annotated[User, Depends(get_current_user_pending)]) -> User:
    if user.must_change_password:
        raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码")
    return user
