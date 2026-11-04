from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.parents import views
from app.models import User

router = APIRouter(prefix="/parent", tags=["parent"])

CurrentUser = Annotated[User, Depends(get_current_user)]
Db = Annotated[Session, Depends(get_db)]


@router.get("/children")
def list_children(user: CurrentUser, db: Db) -> list[views.ParentChild]:
    return views.children(db, user, clock.utc_now())


@router.get("/children/{student_id}/today")
def get_today(
    student_id: UUID, request: Request, user: CurrentUser, db: Db, date: date | None = None
) -> views.ParentToday:
    return views.today(db, request, user, student_id, date, clock.utc_now())


@router.get("/children/{student_id}/profile", response_model_exclude_none=True)
def get_profile(
    student_id: UUID, request: Request, user: CurrentUser, db: Db
) -> views.ParentProfile:
    return views.profile(db, request, user, student_id, clock.utc_now())


@router.put("/children/{student_id}/contacts", response_model_exclude_none=True)
def put_contacts(
    student_id: UUID, body: views.ContactsInput, request: Request, user: CurrentUser, db: Db
) -> views.ParentProfile:
    return views.save_contacts(db, request, user, student_id, body, clock.utc_now())


@router.get("/children/{student_id}/growth-records")
def get_growth(
    student_id: UUID, request: Request, user: CurrentUser, db: Db
) -> dict[str, list[views.ParentGrowthRecord]]:
    return {"items": views.growth_records(db, request, user, student_id, clock.utc_now())}


@router.get("/children/{student_id}/comments")
def get_comments(
    student_id: UUID, request: Request, user: CurrentUser, db: Db
) -> dict[str, list[views.ParentComment]]:
    return {"items": views.comments(db, request, user, student_id, clock.utc_now())}


@router.get("/children/{student_id}/reviews")
def get_reviews(
    student_id: UUID, request: Request, user: CurrentUser, db: Db, cursor: str | None = None
) -> views.ParentReviewPage:
    return views.reviews(db, request, user, student_id, cursor, clock.utc_now())


@router.get("/children/{student_id}/exams")
def get_exams(
    student_id: UUID, request: Request, user: CurrentUser, db: Db
) -> list[views.ParentExamItem]:
    return views.exams(db, request, user, student_id, clock.utc_now())


@router.get("/children/{student_id}/exams/{exam_id}")
def get_exam(
    student_id: UUID, exam_id: UUID, request: Request, user: CurrentUser, db: Db
) -> views.ParentExamDetail:
    return views.exam_detail(db, request, user, student_id, exam_id, clock.utc_now())
