from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny
from app.auth.deps import get_current_user
from app.auth.service import contexts_of
from app.db import get_db
from app.domain.org import service
from app.domain.org.schemas import (
    ClassAdmin,
    ClassInput,
    GradeAdmin,
    GradeInput,
    SchoolInfo,
    YearAdmin,
    YearUpdate,
)
from app.domain.schools.service import require_active_year
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(prefix="/admin", tags=["org"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]


def _org(db: Session, request: Request, user: User, bindings: list[Binding]) -> None:
    ensure_admin(db, request, user.id, bindings, Perm.ORG_MANAGE, user.school_id)


@router.get("/school")
def get_school(request: Request, user: Auth, bindings: Bind, db: Db) -> SchoolInfo:
    # 只读:任何有管理端语境的账号即可(校长 / 主任 / 年级组长 / 信息中心)
    if "admin" not in contexts_of(bindings):
        deny(
            db,
            user_id=user.id,
            action="school.view",
            object_type="school",
            object_id=str(user.school_id),
            request=request,
        )
    return service.get_school(db, user.school_id)


@router.put("/school")
def put_school(
    body: SchoolInfo, request: Request, user: Auth, bindings: Bind, db: Db
) -> SchoolInfo:
    _org(db, request, user, bindings)
    return service.save_school(db, user.school_id, body, user.id, request)


@router.get("/years")
def list_years(request: Request, user: Auth, bindings: Bind, db: Db) -> list[YearAdmin]:
    _org(db, request, user, bindings)
    return service.list_years(db, user.school_id)


@router.put("/years/{year_id}")
def put_year(
    year_id: UUID, body: YearUpdate, request: Request, user: Auth, bindings: Bind, db: Db
) -> YearAdmin:
    _org(db, request, user, bindings)
    return service.update_year(db, user.school_id, year_id, body, user.id, request)


@router.get("/grades")
def list_grades(request: Request, user: Auth, bindings: Bind, db: Db) -> list[GradeAdmin]:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.list_grades(db, user.school_id, year.id)


@router.post("/grades", status_code=201)
def create_grade(
    body: GradeInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> GradeAdmin:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.create_grade(db, user.school_id, year.id, body, user.id, request)


@router.put("/grades/{grade_id}")
def put_grade(
    grade_id: UUID, body: GradeInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> GradeAdmin:
    _org(db, request, user, bindings)
    return service.update_grade(db, user.school_id, grade_id, body, user.id, request)


@router.delete("/grades/{grade_id}", status_code=204)
def delete_grade(grade_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db) -> Response:
    _org(db, request, user, bindings)
    service.delete_grade(db, user.school_id, grade_id, user.id, clock.utc_now(), request)
    return Response(status_code=204)


@router.get("/classes")
def list_classes(
    request: Request, user: Auth, bindings: Bind, db: Db, grade_id: UUID | None = None
) -> list[ClassAdmin]:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.list_classes(db, user.school_id, year.id, grade_id)


@router.get("/classes/{class_id}")
def get_class(class_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db) -> ClassAdmin:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    cls = service.get_class(db, user.school_id, year.id, class_id)
    return service.class_admin(db, cls)


@router.post("/classes", status_code=201)
def create_class(
    body: ClassInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> ClassAdmin:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.create_class(db, user.school_id, year.id, body, user.id, request)


@router.put("/classes/{class_id}")
def put_class(
    class_id: UUID, body: ClassInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> ClassAdmin:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    cls = service.get_class(db, user.school_id, year.id, class_id)
    return service.update_class(db, user.school_id, cls, body, user.id, request)


@router.delete("/classes/{class_id}", status_code=204)
def delete_class(class_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db) -> Response:
    _org(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    cls = service.get_class(db, user.school_id, year.id, class_id)
    service.delete_class(db, cls, user.id, clock.utc_now(), request)
    return Response(status_code=204)
