from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.accounts import security, service
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(prefix="/admin/accounts", tags=["admin-accounts"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


class Ok(BaseModel):
    ok: bool


@router.post("/{user_id}/totp-reset")
def totp_reset(
    user_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Ok:
    ensure_admin(db, request, user.id, bindings, Perm.ACCOUNT_MANAGE, settings.school_id)
    target = service.get_account_or_404(db, settings.school_id, user_id)
    security.reset_totp(db, user, target, request)
    return Ok(ok=True)
