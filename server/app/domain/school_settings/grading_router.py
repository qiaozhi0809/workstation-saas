"""及格 / 优秀线与科目目录:读接口任何已登录用户(含家长)可看,写接口要 settings.manage。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.school_settings import service
from app.domain.school_settings.schemas import Grading, SubjectCatalog
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


@router.get("/school/grading")
def get_grading(user: UserDep, db: DbDep) -> Grading:
    return service.get_grading(db, user.school_id)


@router.get("/school/subject-catalog")
def get_subject_catalog(user: UserDep, db: DbDep) -> SubjectCatalog:
    return SubjectCatalog(**service.get_catalog(db, user.school_id))


@router.put("/admin/settings/grading")
def put_grading(
    body: Grading,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> Grading:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.save_grading(db, settings.school_id, body, user.id, request)


@router.put("/admin/settings/subject-catalog")
def put_subject_catalog(
    body: SubjectCatalog,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
) -> SubjectCatalog:
    ensure_admin(db, request, user.id, bindings, Perm.SETTINGS_MANAGE, settings.school_id)
    return service.save_catalog(db, settings.school_id, body, user.id, request)
