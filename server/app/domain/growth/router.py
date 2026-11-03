from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.audit.service import deny, record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.growth import service
from app.domain.growth.schemas import GrowthInput, GrowthRecordOut
from app.domain.schools.service import active_academic_year, require_active_year
from app.domain.students.service import find_enrolled_student
from app.errors import ApiError
from app.models import GrowthRecord, User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["growth"])


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "学生不存在")


@router.get("/students/{student_id}/growth-records")
def list_growth(
    student_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[GrowthRecordOut]]:
    year = active_academic_year(db, user.school_id)
    if year is None:
        return {"items": []}
    found = find_enrolled_student(db, student_id, year.id)
    if found is None:
        raise _not_found()
    _, scope, _ = found
    ensure(
        db, request, user.id, bindings, Perm.GROWTH_READ, scope,
        object_id=str(student_id), object_type="student",
    )  # fmt: skip
    return {"items": service.list_records(db, student_id, year.id, user.id, bindings)}


@router.post("/students/{student_id}/growth-records", status_code=201)
def create_growth(
    student_id: UUID,
    data: GrowthInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> GrowthRecordOut:
    year = require_active_year(db, user.school_id)
    found = find_enrolled_student(db, student_id, year.id)
    if found is None:
        raise _not_found()
    _, scope, enrollment = found
    ensure(
        db, request, user.id, bindings, Perm.GROWTH_WRITE, scope,
        object_id=str(student_id), object_type="student",
    )  # fmt: skip
    rec = service.create_record(db, student_id, enrollment, user.id, data)
    record(
        db,
        user_id=user.id,
        action="growth.create",
        success=True,
        object_type="student",
        object_id=str(student_id),
        request=request,
    )
    out = service.one_out(db, rec, year.id, user.id, bindings)
    db.commit()
    return out


@router.delete("/growth-records/{record_id}", status_code=204)
def delete_growth(
    record_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    year = require_active_year(db, user.school_id)
    rec = db.get(GrowthRecord, record_id)
    if rec is None:
        raise ApiError(404, "NOT_FOUND", "记录不存在")
    if rec.academic_year_id != year.id:
        raise ApiError(409, "RECORD_READONLY", "往年的记录只读,不能删除")
    if not service.can_delete_record(rec, year.id, user.id, bindings):
        deny(
            db,
            user_id=user.id,
            action="growth.delete",
            object_type="growth_record",
            object_id=str(record_id),
            request=request,
        )
    db.delete(rec)
    record(
        db,
        user_id=user.id,
        action="growth.delete",
        success=True,
        object_type="growth_record",
        object_id=str(record_id),
        request=request,
    )
    db.commit()
    return Response(status_code=204)
