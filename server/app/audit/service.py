import ipaddress
from typing import NoReturn
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models.audit import AuditLog


def _client_ip(request: Request | None) -> str | None:
    """仅当 host 是合法 IP 时返回(ip 列为 inet);TestClient 的 "testclient" 等返回 None。"""
    if request is None or request.client is None:
        return None
    try:
        return str(ipaddress.ip_address(request.client.host))
    except ValueError:
        return None


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
            ip=_client_ip(request),
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
