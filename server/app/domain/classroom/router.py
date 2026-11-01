from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.classroom.schemas import Board, ClassroomSummary
from app.domain.classroom.service import build_summary, save_board
from app.domain.schools.service import require_active_year
from app.domain.students.service import require_enrollment
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["classroom"])


class ClassRoleUpdate(BaseModel):
    class_role: str | None = None

    @field_validator("class_role")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if len(value) > 10:
            raise ValueError("职务最多 10 个字")
        return value


class ClassRoleUpdated(BaseModel):
    enrollment_id: UUID
    class_role: str | None


@router.get("/classes/{class_id}/classroom")
def classroom_summary(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassroomSummary:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.CLASS_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    year = require_active_year(db, cls.school_id)
    return build_summary(db, cls, bindings, year)


@router.put("/classes/{class_id}/board")
def put_board(
    class_id: UUID,
    body: Board,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Board:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.BOARD_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return save_board(db, class_id, body, user.id)


@router.put("/classes/{class_id}/students/{enrollment_id}/class-role")
def put_class_role(
    class_id: UUID,
    enrollment_id: UUID,
    body: ClassRoleUpdate,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassRoleUpdated:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.STUDENT_BASIC_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    enrollment = require_enrollment(db, class_id, enrollment_id)
    enrollment.class_role = body.class_role
    record(
        db,
        user_id=user.id,
        action="student.update_class_role",
        success=True,
        object_type="enrollment",
        object_id=str(enrollment_id),
        request=request,
    )
    db.commit()
    return ClassRoleUpdated(enrollment_id=enrollment_id, class_role=body.class_role)
