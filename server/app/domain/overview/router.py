from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.overview.schemas import BoardClassDetail, BoardView, TodayView
from app.domain.overview.service import (
    board_class_detail,
    board_view,
    ensure_school_view,
    today_view,
)
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings

router = APIRouter(prefix="/admin", tags=["overview"])


@router.get("/today")
def get_today(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> TodayView:
    ensure_school_view(db, request, user, bindings)
    return today_view(db, user, bindings)


@router.get("/board")
def get_board(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
    grade_id: UUID | None = None,
) -> BoardView:
    ensure_school_view(db, request, user, bindings)
    return board_view(db, user, bindings, grade_id, request)


@router.get("/board/classes/{class_id}")
def get_board_class(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> BoardClassDetail:
    ensure_school_view(db, request, user, bindings)
    return board_class_detail(db, user, bindings, class_id, request)
