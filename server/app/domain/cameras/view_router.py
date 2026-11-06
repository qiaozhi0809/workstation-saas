from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from redis import Redis
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.cameras import access
from app.domain.cameras.schemas import CameraWall, ClassCameras
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.errors import ApiError
from app.models import User
from app.rbac.admin import admin_perms
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm
from app.redis import get_redis

router = APIRouter(tags=["cameras"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]
Rds = Annotated[Redis, Depends(get_redis)]


@router.get("/classes/{class_id}/cameras")
def get_class_cameras(
    class_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db, redis: Rds
) -> ClassCameras:
    cls = get_class_or_404(db, class_id)
    if cls.school_id != user.school_id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")  # 先于权限
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.CLASS_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    access.ensure_monitor_on(db, user.school_id)
    return access.class_cameras(db, user, bindings, cls, clock.utc_now(), redis=redis)


@router.get("/admin/camera-wall")
def get_camera_wall(request: Request, user: Auth, bindings: Bind, db: Db, redis: Rds) -> CameraWall:
    perms = admin_perms(bindings)
    if Perm.CAMERA_VIEW.value not in perms and Perm.CAMERA_MANAGE.value not in perms:
        deny(
            db,
            user_id=user.id,
            action=Perm.CAMERA_VIEW.value,
            object_type="school",
            object_id=str(user.school_id),
            request=request,
        )
    access.ensure_monitor_on(db, user.school_id)
    return access.camera_wall(db, user, bindings, redis=redis)
