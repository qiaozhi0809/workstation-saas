import secrets
import string
import unicodedata

import bcrypt

from app.errors import ApiError

MAX_PASSWORD_BYTES = 72


class PasswordTooLong(ValueError):
    pass


def normalize_password(plain: str) -> bytes:
    data = unicodedata.normalize("NFC", plain).encode("utf-8")
    if len(data) > MAX_PASSWORD_BYTES:
        raise PasswordTooLong(f"password exceeds {MAX_PASSWORD_BYTES} bytes")
    return data


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(normalize_password(plain), bcrypt.gensalt(rounds=10)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        data = normalize_password(plain)
    except PasswordTooLong:
        return False
    try:
        return bcrypt.checkpw(data, hashed.encode("ascii"))
    except ValueError:
        return False


_TEMP_LETTERS = "".join(c for c in string.ascii_letters if c not in "IlOo")
_TEMP_DIGITS = "".join(c for c in string.digits if c not in "01")


def _weak(reason: str, message: str) -> ApiError:
    return ApiError(400, "PASSWORD_WEAK", message, {"reason": reason})


def check_policy(new: str, *, old: str | None = None) -> None:
    data = unicodedata.normalize("NFC", new)
    if old is not None and data == unicodedata.normalize("NFC", old):
        raise _weak("same_as_old", "新密码不能与旧密码相同")
    if len(data) < 8:
        raise _weak("too_short", "新密码至少 8 位")
    if len(data.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise _weak("too_long", "新密码太长")
    kinds = {"letter" if c.isalpha() else "digit" if c.isdigit() else "other" for c in data}
    if len(kinds) < 2:
        raise _weak("one_kind", "新密码需包含字母、数字、其他字符中的至少两类")


def generate_temp_password() -> str:
    both = _TEMP_LETTERS + _TEMP_DIGITS
    chars = (
        [secrets.choice(_TEMP_LETTERS) for _ in range(3)]
        + [secrets.choice(_TEMP_DIGITS) for _ in range(3)]
        + [secrets.choice(both) for _ in range(4)]
    )
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)
