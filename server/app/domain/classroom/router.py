from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.classroom.schemas import (
    Board,
    ClassRoleUpdate,
    ClassRoleUpdated,
    ClassroomSummary,
)
from app.domain.classroom.service import build_summary, save_board, set_class_role
from app.domain.schools.service import require_active_year
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["classroom"])


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
    return set_class_role(db, class_id, enrollment_id, body.class_role, user.id, request)
