from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.ai_admin import service
from app.domain.ai_admin.schemas import AiConfigSave, AiConfigView, AiTestResult, AiUsage
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(prefix="/admin/ai", tags=["ai-admin"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/usage")
def get_usage(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    month: str | None = None,
) -> AiUsage:
    ensure_admin(db, request, user.id, bindings, Perm.AI_USAGE, settings.school_id)
    resolved = service.resolve_month(db, settings.school_id, month)
    return service.usage(db, settings.school_id, resolved)


@router.get("/config")
def get_config(
    request: Request, user: UserDep, bindings: BindingsDep, db: DbDep, settings: SettingsDep
) -> AiConfigView:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.config_view(db, settings.school_id, settings.master_key_bytes)


@router.put("/config")
def put_config(
    body: AiConfigSave,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> AiConfigView:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.save_config(
        db, settings.school_id, settings.master_key_bytes, user.id, body, request
    )


@router.delete("/config", status_code=204)
def delete_config(
    request: Request, user: UserDep, bindings: BindingsDep, db: DbDep, settings: SettingsDep
) -> Response:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    service.delete_config(db, settings.school_id, user.id, request)
    return Response(status_code=204)


@router.post("/config/test")
def post_config_test(
    body: AiConfigSave,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> AiTestResult:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.test_config(
        db,
        settings.school_id,
        settings.master_key_bytes,
        body,
        request.app.state.ai_transport,
    )
