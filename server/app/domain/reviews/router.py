from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.reviews import service
from app.domain.reviews.schemas import (
    ItemRevokeResult,
    ReviewCreate,
    ReviewCreated,
    ReviewPage,
    ReviewSummary,
    RevokeResult,
)
from app.domain.schools.service import (
    local_day_start_utc,
    require_active_year,
    school_today,
    school_tz,
    week_monday,
)
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["reviews"])


@router.post("/classes/{class_id}/reviews", status_code=201)
def post_reviews(
    class_id: UUID,
    body: ReviewCreate,
    request: Request,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ReviewCreated:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.REVIEW_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    require_active_year(db, cls.school_id)
    items, created = service.create_reviews(
        db, cls, bindings, user.id, body, today=school_today(db, cls.school_id)
    )
    if not created:
        response.status_code = 200
    return ReviewCreated(items=items)


@router.get("/classes/{class_id}/reviews/summary")
def get_summary(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ReviewSummary:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.REVIEW_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    week_start = week_monday(school_today(db, cls.school_id))
    week_start_utc = local_day_start_utc(week_start, school_tz(db, cls.school_id))
    return service.summarize(db, class_id, week_start_utc, week_start)


@router.get("/classes/{class_id}/reviews")
def get_reviews(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
    cursor: str | None = None,
    enrollment_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ReviewPage:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.REVIEW_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.list_reviews(db, class_id, user.id, cursor, limit, enrollment_id)


@router.post("/classes/{class_id}/reviews/{op_id}/revoke")
def post_revoke(
    class_id: UUID,
    op_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> RevokeResult:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.REVIEW_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.revoke(db, class_id, op_id, user.id, request)


@router.post("/classes/{class_id}/reviews/items/{review_id}/revoke")
def post_revoke_item(
    class_id: UUID,
    review_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemRevokeResult:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.REVIEW_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.revoke_item(db, class_id, review_id, user.id, request)
