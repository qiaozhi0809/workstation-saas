import ipaddress
from typing import NoReturn
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models.audit import AuditLog


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """合法 IP 或 None;带 scope id 的 IPv6(fe80::1%eth0)视为非法,IPv4 映射的 IPv6 归一成 IPv4。"""
    value = value.strip()
    if "%" in value:
        return None
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped
    return addr


def peer_ip(request: Request | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """直连地址(TCP 对端)解析成 IP;没有 client 或不是合法 IP(如 "testclient")返回 None。"""
    if request is None or request.client is None:
        return None
    return _parse_ip(request.client.host)


def client_ip(request: Request | None) -> str | None:
    """仅返回合法 IP(ip 列为 inet);TestClient 的 "testclient" 等返回 None。

    直连地址在 WS_TRUSTED_PROXIES 内时,取 X-Forwarded-For 从右往左第一个不可信的合法 IP;
    头里有非法值或全是可信地址时回退直连地址,绝不抛错。
    """
    peer = peer_ip(request)
    if peer is None:
        return None
    settings = getattr(getattr(request.scope.get("app"), "state", None), "settings", None)
    networks = settings.trusted_networks if settings is not None else []
    if not any(peer in net for net in networks):
        return str(peer)
    header = ",".join(request.headers.getlist("x-forwarded-for"))
    if not header:
        return str(peer)
    for part in reversed(header.split(",")):
        addr = _parse_ip(part)
        if addr is None:
            return str(peer)
        if not any(addr in net for net in networks):
            return str(addr)
    return str(peer)


def record(
    db: Session,
    *,
    user_id: UUID | None,
    action: str,
    success: bool,
    object_type: str | None = None,
    object_id: str | None = None,
    request: Request | None = None,
    extra: dict | None = None,
) -> None:
    """插入一行审计记录,不 commit,由调用方的事务一起提交。"""
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            success=success,
            object_type=object_type,
            object_id=object_id,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent") if request is not None else None,
            extra=extra,
        )
    )
    db.flush()


def deny(
    db: Session,
    *,
    user_id: UUID,
    action: str,
    object_type: str,
    object_id: str,
    request: Request | None = None,
) -> NoReturn:
    """记录失败审计并立即提交,再抛 403,保证请求失败时审计仍落库。"""
    record(
        db,
        user_id=user_id,
        action=action,
        success=False,
        object_type=object_type,
        object_id=object_id,
        request=request,
    )
    db.commit()
    raise ApiError(403, "FORBIDDEN", "没有权限访问该资源")
