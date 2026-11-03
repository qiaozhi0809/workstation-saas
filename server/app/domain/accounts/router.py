from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from redis import Redis
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.accounts import service
from app.domain.accounts.schemas import (
    Account,
    AccountCreate,
    AccountCreated,
    AccountInput,
    AccountPage,
    ImportPreview,
    ImportRequest,
    ImportResult,
    TempPassword,
)
from app.domain.schools.service import active_academic_year
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm
from app.redis import get_redis

router = APIRouter(prefix="/admin/accounts", tags=["admin-accounts"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
RedisDep = Annotated[Redis, Depends(get_redis)]


def _guard(
    db: Session, request: Request, user: User, bindings: list[Binding], s: Settings
) -> UUID | None:
    ensure_admin(db, request, user.id, bindings, Perm.ACCOUNT_MANAGE, s.school_id)
    year = active_academic_year(db, s.school_id)
    return year.id if year else None


@router.get("")
def list_accounts(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> AccountPage:
    year_id = _guard(db, request, user, bindings, settings)
    return service.list_accounts(db, settings.school_id, year_id, q, role, status, page)


@router.post("", status_code=201)
def create_account(
    body: AccountCreate,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> AccountCreated:
    year_id = _guard(db, request, user, bindings, settings)
    account, temp = service.create_account(db, settings.school_id, year_id, user, body, request)
    return AccountCreated(account=account, temp_password=temp)


@router.post("/import/preview")
def import_preview(
    body: ImportRequest,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> ImportPreview:
    _guard(db, request, user, bindings, settings)
    return ImportPreview(rows=service.preview_import(db, settings.school_id, body.csv))


@router.post("/import", status_code=201)
def import_accounts(
    body: ImportRequest,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> ImportResult:
    _guard(db, request, user, bindings, settings)
    created = service.import_accounts(db, settings.school_id, user, body.csv, request)
    return ImportResult(created=created)


@router.put("/{account_id}")
def update_account(
    account_id: UUID,
    body: AccountInput,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Account:
    year_id = _guard(db, request, user, bindings, settings)
    target = service.get_account_or_404(db, settings.school_id, account_id)
    return service.update_account(db, year_id, user, target, body, request)


@router.post("/{account_id}/reset-password")
def reset_password(
    account_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    redis: RedisDep,
) -> TempPassword:
    _guard(db, request, user, bindings, settings)
    target = service.get_account_or_404(db, settings.school_id, account_id)
    return TempPassword(temp_password=service.reset_password(db, redis, user, target, request))


@router.post("/{account_id}/freeze")
def freeze_account(
    account_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    redis: RedisDep,
) -> Account:
    year_id = _guard(db, request, user, bindings, settings)
    target = service.get_account_or_404(db, settings.school_id, account_id)
    return service.freeze(db, redis, year_id, user, target, request)


@router.post("/{account_id}/unfreeze")
def unfreeze_account(
    account_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Account:
    year_id = _guard(db, request, user, bindings, settings)
    target = service.get_account_or_404(db, settings.school_id, account_id)
    return service.unfreeze(db, year_id, user, target, request)
