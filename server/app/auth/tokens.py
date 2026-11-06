from datetime import datetime, timedelta
from uuid import UUID

import jwt

from app import clock
from app.config import Settings


class TokenExpired(Exception):
    pass


class TokenInvalid(Exception):
    pass


def issue_access_token(user_id: UUID, settings: Settings) -> tuple[str, datetime]:
    now = clock.utc_now()
    expires_at = now + timedelta(seconds=settings.access_ttl_seconds)
    token = jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": expires_at},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return token, expires_at


def decode_access_claims(token: str, settings: Settings) -> dict:
    """校验签名与过期,返回 {"sub": UUID, "iat": int, "exp": int};其余声明不外露。"""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "exp", "iat"]},
        )
        iat = payload["iat"]
        if isinstance(iat, bool) or not isinstance(iat, int):
            raise TokenInvalid
        exp = payload["exp"]
        if isinstance(exp, bool) or not isinstance(exp, int):
            raise TokenInvalid
        return {"sub": UUID(payload["sub"]), "iat": iat, "exp": exp}
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpired from exc
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise TokenInvalid from exc


def decode_access_token(token: str, settings: Settings) -> UUID:
    return decode_access_claims(token, settings)["sub"]
