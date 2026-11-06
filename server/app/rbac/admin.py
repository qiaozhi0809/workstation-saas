from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import RoleBinding, User
from app.rbac.bindings import Binding, Scope
from app.rbac.guard import ensure
from app.rbac.roles import LEADER_ROLES, ROLE_PERMS, Perm, Role

SCHOOL_VIEW = "school.view"

# 契约 AdminPerm 的顺序
ADMIN_PERM_ORDER: tuple[str, ...] = (
    SCHOOL_VIEW,
    Perm.ORG_MANAGE.value,
    Perm.ACCOUNT_MANAGE.value,
    Perm.SETTINGS_MANAGE.value,
    Perm.AUDIT_READ.value,
    Perm.AI_USAGE.value,
    Perm.NOTICE_SEND.value,
    Perm.GRADE_EXAM_WRITE.value,
    Perm.YEAR_UPGRADE.value,
    Perm.CAMERA_MANAGE.value,
    Perm.CAMERA_VIEW.value,
)


def admin_perms(bindings: Sequence[Binding]) -> list[str]:
    """某绑定的角色有该权限点即算(不看作用域);school.view = 有任一 LEADER_ROLES 绑定。"""
    held = {perm.value for bd in bindings for perm in ROLE_PERMS[bd.role]}
    if any(bd.role in LEADER_ROLES for bd in bindings):
        held.add(SCHOOL_VIEW)
    return [p for p in ADMIN_PERM_ORDER if p in held]


def school_scope(school_id: UUID) -> Scope:
    return Scope(school_id=school_id)


def ensure_admin(
    db: Session,
    request: Request | None,
    user_id: UUID,
    bindings: Sequence[Binding],
    perm: Perm,
    school_id: UUID,
    *,
    grade_id: UUID | None = None,
) -> None:
    target = school_scope(school_id) if grade_id is None else Scope(school_id, grade_id)
    ensure(
        db,
        request,
        user_id,
        bindings,
        perm,
        target,
        object_id=str(school_id),
        object_type="school",
    )


def account_admin_count(
    db: Session, school_id: UUID, *, excluding_binding: UUID | None = None
) -> int:
    stmt = (
        select(func.count(func.distinct(User.id)))
        .join(RoleBinding, RoleBinding.user_id == User.id)
        .where(
            User.school_id == school_id,
            User.status == "active",
            RoleBinding.ended_at.is_(None),
            RoleBinding.role_type.in_([Role.principal.value, Role.it_admin.value]),
        )
    )
    if excluding_binding is not None:
        stmt = stmt.where(RoleBinding.id != excluding_binding)
    return db.scalar(stmt) or 0
