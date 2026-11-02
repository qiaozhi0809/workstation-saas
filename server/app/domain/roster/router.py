from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.roster import service
from app.domain.roster.schemas import StudentInput, StudentRecord
from app.domain.schools.service import active_academic_year
from app.domain.students.service import require_enrollment
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["roster"])


@router.get("/classes/{class_id}/students/records", response_model_exclude_unset=True)
def student_records(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[StudentRecord]]:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.STUDENT_LIST,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    year = active_academic_year(db, user.school_id)
    if year is None:
        return {"items": []}
    return {"items": service.student_records(db, cls, year.id, bindings)}


@router.post("/classes/{class_id}/students", status_code=201, response_model_exclude_unset=True)
def create_student(
    class_id: UUID,
    data: StudentInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentRecord:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.STUDENT_MANAGE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.create_student(db, cls, data, user.id, bindings, request)


@router.put("/classes/{class_id}/students/{enrollment_id}", response_model_exclude_unset=True)
def update_student(
    class_id: UUID,
    enrollment_id: UUID,
    data: StudentInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentRecord:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.STUDENT_MANAGE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    enrollment = require_enrollment(db, class_id, enrollment_id)
    return service.update_student(db, cls, enrollment, data, user.id, bindings, request)


@router.delete("/classes/{class_id}/students/{enrollment_id}", status_code=204)
def remove_student(
    class_id: UUID,
    enrollment_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.STUDENT_MANAGE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    enrollment = require_enrollment(db, class_id, enrollment_id)
    service.remove_student(db, cls, enrollment, user.id, request)
    return Response(status_code=204)
