from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.audit_query import service
from app.domain.audit_query.service import AuditActions, AuditFilters, AuditPage
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["audit-query"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/admin/audit/actions")
def audit_actions(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> AuditActions:
    ensure_admin(db, request, user.id, bindings, Perm.AUDIT_READ, settings.school_id)
    return service.actions_view()


@router.get("/admin/audit")
def audit_list(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    user_id: UUID | None = None,
    group: str | None = None,
    action: str | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    success: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> AuditPage:
    ensure_admin(db, request, user.id, bindings, Perm.AUDIT_READ, settings.school_id)
    filters = AuditFilters(
        date_from=date_from,
        date_to=date_to,
        user_id=user_id,
        group=group,
        action=action,
        object_type=object_type,
        object_id=object_id,
        success=success,
        page=page,
    )
    items, total = service.query(db, settings.school_id, filters)
    return AuditPage(items=items, total=total)
