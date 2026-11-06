"""HLS 播放:片段签名、播放列表改写、内网来源、按需拉流信号、审计节流。

签名只覆盖 (camera_id, user_id, exp);片段名由路由的白名单正则约束。"""

import base64
import hashlib
import hmac
import re
import time
from collections.abc import Callable
from pathlib import Path
from uuid import UUID

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import Request
from redis import Redis

from app.audit.service import _client_ip
from app.config import Settings
from app.domain.cameras.lan import is_lan_ip
from app.errors import ApiError

SEGMENT_RE = re.compile(r"seg-[0-9]{1,8}\.ts")
MAX_TTL = 60  # 片段地址有效期上限(秒)
SIG_LEN = 22
WANT_KEY = "ws:cam:want:{}"
WANT_TTL = 30
AUDIT_KEY = "ws:cam:audit:{}:{}"
AUDIT_WINDOW = 300
_DOMAIN = b"ws-hls-segment-v1"


def _key(settings: Settings) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"ws-hls").derive(
        settings.jwt_secret.encode()
    )


def _mac(settings: Settings, camera_id: UUID, user_id: UUID, exp: int) -> str:
    msg = b"\x00".join([_DOMAIN, str(camera_id).encode(), str(user_id).encode(), str(exp).encode()])
    digest = hmac.new(_key(settings), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:SIG_LEN]


def sign(settings: Settings, camera_id: UUID, user_id: UUID, exp: int) -> str:
    return _mac(settings, camera_id, user_id, exp)


def verify(
    settings: Settings, camera_id: UUID, user_id: UUID, exp: int, sig: str, now: int | float
) -> bool:
    if exp < now or exp - now > MAX_TTL:
        return False
    if not isinstance(sig, str):
        return False
    return hmac.compare_digest(_mac(settings, camera_id, user_id, exp), sig)


def rewrite_playlist(text: str, camera_id: UUID, user_id: UUID, exp: int, sig: str) -> str:
    """片段行改成带签名的相对地址;`#` 行原样;其余不符合白名单的行丢弃(绝不放行)。"""
    out: list[str] = []
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            out.append(line)
        elif SEGMENT_RE.fullmatch(line):
            out.append(f"hls/{line}?exp={exp}&u={user_id}&sig={sig}")
    return "\n".join(out) + "\n"


def ensure_lan(request: Request, settings: Settings) -> None:
    """只接受内网来源;来源不明一律拒绝(失败即关)。开发环境放行回环。"""
    ip = _client_ip(request)
    if ip is None or not is_lan_ip(ip, allow_loopback=settings.env == "dev"):
        raise ApiError(403, "CAMERA_LAN_ONLY", "只能在学校内网观看")


def touch_want(redis: Redis, camera_id: UUID) -> None:
    redis.set(WANT_KEY.format(camera_id), "1", ex=WANT_TTL)


def await_playlist(
    path: Path,
    timeout: float = 8,
    interval: float = 0.2,
    *,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> bool:
    """同步轮询等 worker 写出播放列表(占用一个线程池线程,见 R9)。"""
    deadline = monotonic() + timeout
    while True:
        try:
            if path.stat().st_size > 0:
                return True
        except OSError:
            pass
        if monotonic() >= deadline:
            return False
        sleep(interval)


def audit_due(redis: Redis, user_id: UUID, camera_id: UUID) -> bool:
    """同一用户同一摄像头 5 分钟内只记一次。"""
    return bool(redis.set(AUDIT_KEY.format(user_id, camera_id), "1", nx=True, ex=AUDIT_WINDOW))
