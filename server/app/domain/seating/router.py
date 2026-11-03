from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.seating import layout, service
from app.domain.seating.schemas import (
    LayoutDraft,
    LayoutPreview,
    LayoutSave,
    LayoutSaved,
    SeatingSave,
    SeatingSaved,
)
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["seating"])


@router.put("/classes/{class_id}/seating")
def put_seating(
    class_id: UUID,
    body: SeatingSave,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> SeatingSaved:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.SEATING_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.save_seating(db, cls, body, user.id)


@router.post("/classes/{class_id}/layout/preview")
def post_layout_preview(
    class_id: UUID,
    body: LayoutDraft,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> LayoutPreview:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.SEATING_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return layout.preview_layout(db, cls, body)


@router.put("/classes/{class_id}/layout")
def put_layout(
    class_id: UUID,
    body: LayoutSave,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> LayoutSaved:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.SEATING_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return layout.save_layout(db, cls, body, user.id, request)
