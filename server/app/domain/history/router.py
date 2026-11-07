from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.history.schemas import (
    HistoryClass,
    HistoryClassLocation,
    HistoryExam,
    HistoryRoster,
    HistoryScores,
    HistoryYear,
)
from app.domain.history.service import (
    class_exams,
    class_students,
    exam_scores,
    locate_class,
    past_classes,
    past_years,
)
from app.domain.overview.service import ensure_school_view
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings

router = APIRouter(prefix="/admin/history", tags=["history"])


@router.get("/years")
def get_years(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[HistoryYear]:
    ensure_school_view(db, request, user, bindings)
    return past_years(db, user.school_id)


@router.get("/classes")
def get_classes(
    year_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[HistoryClass]:
    ensure_school_view(db, request, user, bindings)
    return past_classes(db, user, bindings, year_id)


@router.get("/classes/{class_id}")
def get_class_location(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> HistoryClassLocation:
    ensure_school_view(db, request, user, bindings)
    return locate_class(db, user, bindings, class_id, request)


@router.get("/classes/{class_id}/students")
def get_class_students(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> HistoryRoster:
    ensure_school_view(db, request, user, bindings)
    return class_students(db, user, bindings, class_id, request)


@router.get("/classes/{class_id}/exams")
def get_class_exams(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[HistoryExam]:
    ensure_school_view(db, request, user, bindings)
    return class_exams(db, user, bindings, class_id, request)


@router.get("/exams/{exam_id}/scores")
def get_exam_scores(
    exam_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> HistoryScores:
    ensure_school_view(db, request, user, bindings)
    return exam_scores(db, user, bindings, exam_id, request)
