import hmac
import io
from datetime import datetime
from uuid import UUID

import pyotp
import segno
from redis import Redis

STEP_SECONDS = 30
DIGITS = 6
_USED_TTL = 90  # 覆盖码的整个有效期(±1 步长共 90 秒)


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning(secret: str, *, issuer: str, account: str) -> tuple[str, str]:
    """返回 otpauth URI 与二维码 SVG(单个 <svg> 元素,无 XML 声明)。"""
    uri = pyotp.TOTP(secret, digits=DIGITS, interval=STEP_SECONDS).provisioning_uri(
        name=account, issuer_name=issuer
    )
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=4, xmldecl=False, nl=False)
    return uri, buf.getvalue().decode()


def verify(redis: Redis, user_id: UUID, secret: str, code: str, now: datetime) -> bool:
    """RFC 6238(SHA1/6 位/30 秒),前后各 1 个步长;同一账号同一步长的码只能用一次。"""
    if len(code) != DIGITS or not (code.isascii() and code.isdigit()):
        return False
    gen = pyotp.TOTP(secret, digits=DIGITS, interval=STEP_SECONDS)
    step = int(now.timestamp()) // STEP_SECONDS
    matched = [
        s for s in (step - 1, step, step + 1) if hmac.compare_digest(gen.generate_otp(s), code)
    ]
    if not matched:
        return False
    # SETNX:同一步长的码第二次来(重放)拿不到
    return bool(redis.set(f"ws:totp:used:{user_id}:{matched[0]}", "1", nx=True, ex=_USED_TTL))
