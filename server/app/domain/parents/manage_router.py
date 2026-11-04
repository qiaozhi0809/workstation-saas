from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from redis import Redis
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.parents import manage
from app.domain.parents.schemas import (
    ParentCreated,
    ParentInput,
    ParentOfStudent,
    ParentTempPassword,
)
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.redis import get_redis

router = APIRouter(tags=["parents"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/students/{student_id}/parents")
def list_parents(
    student_id: UUID, request: Request, user: UserDep, bindings: BindingsDep, db: DbDep
) -> list[ParentOfStudent]:
    student = manage.lock_student(db, user.school_id, student_id)
    manage.authorize(db, request, user, bindings, student)
    return manage.list_parents(db, student)


@router.post("/students/{student_id}/parents", status_code=201)
def add_parent(
    student_id: UUID,
    body: ParentInput,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
) -> ParentCreated:
    return manage.add_parent(db, request, user, bindings, student_id, body)


@router.post("/parent-links/{link_id}/primary")
def set_primary(
    link_id: UUID, request: Request, user: UserDep, bindings: BindingsDep, db: DbDep
) -> list[ParentOfStudent]:
    return manage.set_primary(db, request, user, bindings, link_id)


@router.delete("/parent-links/{link_id}", status_code=204)
def unlink(
    link_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
) -> Response:
    manage.unlink(db, redis, request, user, bindings, link_id)
    return Response(status_code=204)


@router.post("/parent-links/{link_id}/reset-password")
def reset_password(
    link_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
) -> ParentTempPassword:
    temp = manage.reset_parent_password(db, redis, settings, request, user, bindings, link_id)
    return ParentTempPassword(temp_password=temp)
