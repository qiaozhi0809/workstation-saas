from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.exams import service
from app.domain.exams.schemas import (
    ExamInput,
    ExamOut,
    Gradebook,
    ScoreSheet,
    ScoresSave,
    ScoresSaved,
    SubjectFull,
)
from app.domain.exams.subjects import class_subjects
from app.errors import ApiError
from app.models import Exam, User
from app.rbac.bindings import Binding, visible_subjects
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["exams"])


@router.get("/classes/{class_id}/subjects")
def list_subjects(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[SubjectFull]]:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return {"items": class_subjects(db, cls)}


@router.get("/classes/{class_id}/exams")
def list_exams(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[ExamOut]]:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return {"items": service.list_exams(db, cls, bindings, user.id)}


@router.post("/classes/{class_id}/exams", status_code=201)
def create_exam(
    class_id: UUID,
    data: ExamInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExamOut:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.create_exam(db, cls, data, user.id, bindings, request)


@router.put("/classes/{class_id}/exams/{exam_id}")
def update_exam(
    class_id: UUID,
    exam_id: UUID,
    data: ExamInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExamOut:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    exam = service.get_visible_exam(db, cls, exam_id, bindings, lock=True)
    service.ensure_exam_owner(db, request, user.id, bindings, cls, exam)
    service.ensure_not_grade_managed(exam)
    return service.update_exam(db, cls, exam, data, user.id, bindings, request)


@router.delete("/classes/{class_id}/exams/{exam_id}", status_code=204)
def delete_exam(
    class_id: UUID,
    exam_id: UUID,
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
        Perm.EXAM_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    exam = service.get_visible_exam(db, cls, exam_id, bindings, lock=True)
    service.ensure_exam_owner(db, request, user.id, bindings, cls, exam)
    service.ensure_exam_deletable(db, request, user.id, bindings, cls, exam)
    service.ensure_not_grade_managed(exam)
    service.delete_exam(db, cls, exam, user.id, bindings, request)
    return Response(status_code=204)


@router.get("/classes/{class_id}/exams/{exam_id}/scores")
def get_scores(
    class_id: UUID,
    exam_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ScoreSheet:
    cls = get_class_or_404(db, class_id)
    scope = class_scope_of(cls)
    ensure(db, request, user.id, bindings, Perm.EXAM_READ, scope, object_id=str(class_id))
    exam = service.get_visible_exam(db, cls, exam_id, bindings)
    return service.score_sheet(db, cls, exam, visible_subjects(bindings, scope), user.id)


@router.put("/classes/{class_id}/exams/{exam_id}/scores")
def put_scores(
    class_id: UUID,
    exam_id: UUID,
    data: ScoresSave,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ScoresSaved:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.SCORE_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    exam = service.get_visible_exam(db, cls, exam_id, bindings, lock=True)
    n = service.save_scores(db, cls, exam, data.cells, user.id, bindings, request)
    return ScoresSaved(updated=n)


@router.get("/classes/{class_id}/exams/{exam_id}/export")
def export_scores(
    class_id: UUID,
    exam_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> ScoreSheet:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.SCORE_EXPORT,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    exam = db.get(Exam, exam_id)
    if exam is None or exam.class_id != cls.id:
        raise ApiError(404, "NOT_FOUND", "考试不存在")
    return service.export_scores(db, cls, exam, user.id, request)


@router.get("/classes/{class_id}/gradebook")
def get_gradebook(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Gradebook:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return service.gradebook(db, cls, bindings, user.id)
