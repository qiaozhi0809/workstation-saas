from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.overview.service import ensure_school_view
from app.domain.reports import scores
from app.domain.reports.schemas import ScoreStudents, ScoreSummary
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings

router = APIRouter(prefix="/admin/reports", tags=["reports"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]


@router.get("/scores")
def score_summary(
    grade_exam_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db
) -> ScoreSummary:
    ensure_school_view(db, request, user, bindings)
    return scores.score_summary(db, user, bindings, grade_exam_id, request=request)


@router.get("/scores/students")
def score_students(
    grade_exam_id: UUID,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    class_id: UUID | None = None,
) -> ScoreStudents:
    ensure_school_view(db, request, user, bindings)
    rows = scores.score_students(db, user, bindings, grade_exam_id, class_id, request=request)
    return ScoreStudents(students=rows)


@router.get("/scores/export")
def export_scores(
    grade_exam_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db
) -> Response:
    ensure_school_view(db, request, user, bindings)
    stem, text = scores.export_grade_exam(db, user, bindings, grade_exam_id, request=request)
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            # ASCII 兜底文件名 + RFC 5987 的 UTF-8 文件名
            "Content-Disposition": (
                f"attachment; filename=\"scores.csv\"; filename*=UTF-8''{quote(stem + '.csv')}"
            )
        },
    )
