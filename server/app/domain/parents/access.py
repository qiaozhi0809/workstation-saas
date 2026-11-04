"""家长访问孩子数据的判定:绑定的有效状态与 child_link_or_deny。"""

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.service import deny
from app.models import User
from app.models.parents import Parent, ParentLink
from app.rbac.bindings import Binding, Scope
from app.rbac.roles import Role

READONLY_DAYS = 365


def effective_status(link: ParentLink, now: datetime) -> Literal["active", "readonly"] | None:
    """`now` 必须是带时区的 datetime(与库里 timestamptz 比较,naive 会 TypeError)。"""
    if link.status == "active":
        return "active"
    if link.status == "readonly" and link.readonly_since is not None:
        if link.readonly_since + timedelta(days=READONLY_DAYS) > now:
            return "readonly"
    return None


def my_links(db: Session, user_id: UUID, now: datetime) -> list[ParentLink]:
    rows = db.scalars(
        select(ParentLink)
        .join(Parent, Parent.id == ParentLink.parent_id)
        .where(Parent.user_id == user_id)
        .order_by(ParentLink.created_at, ParentLink.id)
    ).all()
    return [link for link in rows if effective_status(link, now) is not None]


def child_link_or_deny(
    db: Session,
    request: Request | None,
    user: User,
    student_id: UUID,
    *,
    now: datetime,
    write: bool = False,
) -> ParentLink:
    link = next((lk for lk in my_links(db, user.id, now) if lk.student_id == student_id), None)
    if link is not None and (
        not write or (effective_status(link, now) == "active" and link.is_primary)
    ):
        return link
    deny(
        db,
        user_id=user.id,
        action="parent.view",
        object_type="student",
        object_id=str(student_id),
        request=request,
    )


def parent_bindings(link: ParentLink) -> list[Binding]:
    role = Role.primary_parent if link.is_primary else Role.secondary_parent
    return [Binding(role, Scope(student_id=link.student_id), None)]
