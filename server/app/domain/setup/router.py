"""`GET /admin/setup-checklist`:开学准备清单。

判权(R6):有 org.manage 的按 Perm.ORG_MANAGE 调 ensure_admin,否则按 Perm.SETTINGS_MANAGE——
权限点不新增,两种都没有的(年级组长)被拒时审计落在 settings.manage 上。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.setup.service import SetupItem, setup_checklist
from app.models import User
from app.rbac.admin import admin_perms, ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["setup"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/admin/setup-checklist")
def get_setup_checklist(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> list[SetupItem]:
    has_org = Perm.ORG_MANAGE.value in admin_perms(bindings)
    perm = Perm.ORG_MANAGE if has_org else Perm.SETTINGS_MANAGE
    ensure_admin(db, request, user.id, bindings, perm, settings.school_id)
    return setup_checklist(db, settings.school_id, settings.master_key_bytes)
