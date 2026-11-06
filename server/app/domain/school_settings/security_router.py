from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.school_settings import service
from app.domain.school_settings.schemas import SecuritySettings
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["school-settings"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/admin/settings/security")
def get_security(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> SecuritySettings:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.get_security(db, settings.school_id)


@router.put("/admin/settings/security")
def put_security(
    body: SecuritySettings,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> SecuritySettings:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.save_security(db, settings.school_id, body, user.id, request)
