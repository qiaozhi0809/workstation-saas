from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.config import Settings


class TokenExpired(Exception):
    pass


class TokenInvalid(Exception):
    pass


def issue_access_token(user_id: UUID, settings: Settings) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.access_ttl_seconds)
    token = jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": expires_at},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return token, expires_at


def decode_access_token(token: str, settings: Settings) -> UUID:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "exp", "iat"]},
        )
        return UUID(payload["sub"])
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpired from exc
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise TokenInvalid from exc
