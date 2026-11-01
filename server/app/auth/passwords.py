import unicodedata

import bcrypt

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
