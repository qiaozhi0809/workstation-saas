from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.school_settings import service
from app.domain.school_settings.schemas import Switches, TagPool, TagPoolSave
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


@router.get("/school/tag-pool")
def tag_pool(user: UserDep, db: DbDep) -> TagPool:
    return TagPool(tags=service.get_tag_pool(db, user.school_id))


@router.put("/admin/settings/tag-pool")
def save_tag_pool(
    body: TagPoolSave,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> TagPool:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    tags = service.save_tag_pool(db, settings.school_id, user.id, body.tags, body.renames, request)
    return TagPool(tags=tags)


@router.get("/admin/settings/switches")
def get_switches(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Switches:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.get_switches(db, settings.school_id)


@router.put("/admin/settings/switches")
def put_switches(
    body: Switches,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Switches:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.save_switches(db, settings.school_id, user.id, body, request)
