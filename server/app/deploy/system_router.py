import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import clock, version
from app.audit.service import record
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.deploy.diagnostics import build_bundle, current_revision
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["system"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


class LastBackup(BaseModel):
    at: str
    file: str
    size_bytes: int


class SystemInfo(BaseModel):
    version: str
    migration: str | None
    started_at: datetime
    db_size_bytes: int
    last_backup: LastBackup | None


def read_last_backup(settings: Settings) -> LastBackup | None:
    """读 <log_dir>/backup-last.json;没有、读不了或内容不合格都返回 None,不抛错。"""
    if settings.log_dir is None:
        return None
    try:
        raw = json.loads((settings.log_dir / "backup-last.json").read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return None
        at, file, size = raw.get("at"), raw.get("file"), raw.get("size_bytes")
        if not (isinstance(at, str) and isinstance(file, str)):
            return None
        if isinstance(size, bool) or not isinstance(size, int):
            return None
        return LastBackup(at=at, file=file, size_bytes=size)
    except (OSError, ValueError):
        return None


@router.get("/admin/system/info")
def system_info(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> SystemInfo:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    size = db.execute(text("SELECT pg_database_size(current_database())")).scalar_one()
    return SystemInfo(
        version=version.APP_VERSION,
        migration=current_revision(db),
        started_at=version.STARTED_AT,
        db_size_bytes=size,
        last_backup=read_last_backup(settings),
    )


@router.get("/admin/system/diagnostics")
def diagnostics(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Response:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    now = clock.utc_now()
    content = build_bundle(request.app.state.engine, settings, now)
    record(db, user_id=user.id, action="system.diagnostics", success=True, request=request)
    db.commit()
    name = f"ws-diagnostics-{now:%Y%m%d-%H%M%S}.zip"
    return Response(
        content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
