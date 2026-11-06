"""登录日志:每次登录尝试(成功或失败)落一行,并判定"凌晨 / 新网络"两类可疑登录。

只记登录名、结果、IP 与 User-Agent;不记密码、验证码、mfa_token。
"""

import ipaddress
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import CIDR
from sqlalchemy.orm import Session

from app.audit.service import _client_ip
from app.config import Settings
from app.domain.schools.service import school_tz
from app.models import LoginLog, User

LoginOutcome = Literal[
    "success", "bad_password", "unknown_user", "inactive", "locked", "totp_failed"
]

USER_AGENT_MAX = 300
LOGIN_NAME_MAX = 64
NIGHT_END_HOUR = 5
NEW_NETWORK_DAYS = 90
NEW_NETWORK_MIN_HISTORY = 3


def _normalize(ip: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped  # ::ffff:a.b.c.d 与 a.b.c.d 是同一个对端
    return addr


def network_of(ip: str) -> str:
    """IPv4 取 /24,IPv6 取 /64;IPv4-mapped IPv6 先还原成 IPv4。"""
    addr = _normalize(ip)
    return str(ipaddress.ip_network(f"{addr}/{24 if addr.version == 4 else 64}", strict=False))


def suspicious_reasons(
    db: Session, user: User, ip: str | None, now: datetime, tz: ZoneInfo
) -> list[str]:
    reasons: list[str] = []
    if 0 <= now.astimezone(tz).hour < NIGHT_END_HOUR:
        reasons.append("night")
    if ip is not None:
        net = network_of(ip)
        since = now - timedelta(days=NEW_NETWORK_DAYS)
        total, same = db.execute(
            select(
                func.count(),
                func.count().filter(
                    LoginLog.ip.is_not(None), LoginLog.ip.op("<<=")(cast(net, CIDR))
                ),
            ).where(
                LoginLog.user_id == user.id,
                LoginLog.result == "success",
                LoginLog.ip.is_not(None),
                LoginLog.created_at >= since,
            )
        ).one()
        if total >= NEW_NETWORK_MIN_HISTORY and same == 0:
            reasons.append("new_network")
    return reasons


def write(
    db: Session,
    settings: Settings,
    *,
    user: User | None,
    login_name: str,
    result: LoginOutcome,
    request: Request | None,
    now: datetime,
) -> LoginLog:
    """在自己的 SAVEPOINT 里插入并提交,失败的登录也能留下记录。"""
    ip = _client_ip(request)
    if ip is not None:
        ip = str(_normalize(ip))  # 入库前还原 IPv4-mapped,历史与新记录才能按网段比
    ua = request.headers.get("user-agent") if request is not None else None
    reasons: list[str] = []
    if result == "success" and user is not None:
        reasons = suspicious_reasons(db, user, ip, now, school_tz(db, settings.school_id))
    log = LoginLog(
        school_id=settings.school_id,
        user_id=None if user is None else user.id,
        login_name=login_name[:LOGIN_NAME_MAX],
        result=result,
        ip=ip,
        user_agent=None if ua is None else ua[:USER_AGENT_MAX],
        suspicious=reasons,
        created_at=now,
    )
    with db.begin_nested():
        db.add(log)
    db.commit()
    return log
