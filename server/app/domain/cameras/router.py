from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from redis import Redis
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.cameras import playback, service
from app.domain.cameras.schemas import CameraHealth, CameraInput, CameraOut, CameraTestResult
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm
from app.redis import get_redis

router = APIRouter(tags=["cameras"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]
Rds = Annotated[Redis, Depends(get_redis)]
Cfg = Annotated[Settings, Depends(settings_dep)]


def _guard(db: Session, request: Request, user: User, bindings: list[Binding]) -> None:
    ensure_admin(db, request, user.id, bindings, Perm.CAMERA_MANAGE, user.school_id)
    service.require_monitor(db, user.school_id)  # 开关关闭 = 功能不存在


@router.get("/admin/cameras")
def list_cameras(
    request: Request, user: Auth, bindings: Bind, db: Db, redis: Rds
) -> list[CameraOut]:
    _guard(db, request, user, bindings)
    return service.list_cameras(db, redis, user.school_id)


@router.get("/admin/cameras/health")
def health(request: Request, user: Auth, bindings: Bind, db: Db, redis: Rds) -> CameraHealth:
    _guard(db, request, user, bindings)
    return CameraHealth(public_hosts=service.public_hosts(redis))


@router.post("/admin/cameras", status_code=201)
def create_camera(
    body: CameraInput,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    redis: Rds,
    settings: Cfg,
) -> CameraOut:
    _guard(db, request, user, bindings)
    return service.create_camera(db, redis, settings, user.school_id, user.id, body, request)


@router.put("/admin/cameras/{camera_id}")
def update_camera(
    camera_id: UUID,
    body: CameraInput,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    redis: Rds,
    settings: Cfg,
) -> CameraOut:
    _guard(db, request, user, bindings)
    return service.update_camera(
        db, redis, settings, user.school_id, user.id, camera_id, body, request
    )


@router.delete("/admin/cameras/{camera_id}", status_code=204)
def delete_camera(
    camera_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db, redis: Rds
) -> Response:
    _guard(db, request, user, bindings)
    service.delete_camera(db, redis, user.school_id, user.id, camera_id, request)
    return Response(status_code=204)


@router.post("/admin/cameras/{camera_id}/test")
def test_camera(
    camera_id: UUID,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    redis: Rds,
    settings: Cfg,
) -> CameraTestResult:
    _guard(db, request, user, bindings)
    return service.run_test(
        db,
        redis,
        user.school_id,
        user.id,
        camera_id,
        request,
        show_preview=playback.is_lan_client(request, settings),
    )
