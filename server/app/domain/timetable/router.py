from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.audit.service import deny
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.schools.service import require_active_year
from app.domain.timetable import importer, service
from app.domain.timetable.schemas import (
    ClassTimetable,
    Period,
    PeriodsInput,
    TimetableImportResult,
    TimetableInput,
)
from app.errors import ApiError
from app.models import User
from app.rbac.admin import SCHOOL_VIEW, admin_perms, ensure_admin
from app.rbac.bindings import Binding, can
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["timetable"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]

MAX_CSV_BYTES = 1_000_000


def _org(db: Session, request: Request, user: User, bindings: list[Binding]) -> None:
    ensure_admin(db, request, user.id, bindings, Perm.ORG_MANAGE, user.school_id)


@router.get("/periods")
def get_periods(request: Request, user: Auth, bindings: Bind, db: Db) -> list[Period]:
    if not bindings:  # 只有家长身份(或无岗位)的账号没有教职工绑定
        deny(
            db,
            user_id=user.id,
            action=SCHOOL_VIEW,
            object_type="school",
            object_id=str(user.school_id),
            request=request,
        )
    return service.list_periods(db, user.school_id)


@router.put("/admin/periods")
def put_periods(
    body: PeriodsInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> list[Period]:
    _org(db, request, user, bindings)
    return service.save_periods(db, user.school_id, body.periods, user.id, request)


@router.get("/classes/{class_id}/timetable")
def get_timetable(
    class_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db
) -> ClassTimetable:
    cls = get_class_or_404(db, class_id)
    if cls.school_id != user.school_id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")  # 别校的班一律当不存在
    perms = admin_perms(bindings)
    if not (
        can(bindings, Perm.CLASS_READ, class_scope_of(cls))
        or SCHOOL_VIEW in perms
        or Perm.ORG_MANAGE.value in perms
    ):
        deny(
            db,
            user_id=user.id,
            action=Perm.CLASS_READ.value,
            object_type="class",
            object_id=str(class_id),
            request=request,
        )
    year = require_active_year(db, cls.school_id)
    return service.class_timetable(db, cls, year)


@router.put("/admin/classes/{class_id}/timetable")
def put_timetable(
    class_id: UUID,
    body: TimetableInput,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
) -> ClassTimetable:
    _org(db, request, user, bindings)
    cls = get_class_or_404(db, class_id)
    if cls.school_id != user.school_id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")  # 别校的班一律当不存在
    year = require_active_year(db, cls.school_id)
    return service.save_class_timetable(db, cls, year, body.cells, user.id, request)


@router.post("/admin/timetable/import")
def import_timetable(
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    raw: Annotated[bytes, Body(media_type="text/csv")],
) -> TimetableImportResult:
    _org(db, request, user, bindings)
    if len(raw) > MAX_CSV_BYTES:
        raise ApiError(400, "BAD_REQUEST", "文件太大")
    year = require_active_year(db, user.school_id)
    rows = importer.parse_csv(raw)
    return importer.import_rows(db, user.school_id, year, rows, user.id, request)
