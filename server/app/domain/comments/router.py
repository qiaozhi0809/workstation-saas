from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.comments import service
from app.domain.comments.schemas import (
    CommentBulk,
    CommentBulkResult,
    CommentInput,
    CommentOut,
)
from app.domain.schools.service import active_academic_year, require_active_year, school_today
from app.domain.students.service import find_enrolled_student
from app.errors import ApiError
from app.models import Comment, User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["comments"])


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "学生不存在")


@router.get("/students/{student_id}/comments")
def list_comments(
    student_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[CommentOut]]:
    year = active_academic_year(db, user.school_id)
    if year is None:
        return {"items": []}
    found = find_enrolled_student(db, student_id, year.id)
    if found is None:
        raise _not_found()
    _, scope, _ = found
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_READ, scope,
        object_id=str(student_id), object_type="student",
    )  # fmt: skip
    return {"items": service.list_comments(db, student_id, year.id, bindings, scope)}


@router.post("/students/{student_id}/comments", status_code=201)
def create_comment(
    student_id: UUID,
    data: CommentInput,
    request: Request,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> CommentOut:
    year = require_active_year(db, user.school_id)
    found = find_enrolled_student(db, student_id, year.id)
    if found is None:
        raise _not_found()
    _, scope, enrollment = found
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_WRITE, scope,
        object_id=str(student_id), object_type="student",
    )  # fmt: skip
    comment, created = service.create_comment(
        db,
        student_id,
        enrollment,
        year,
        user,
        data.content,
        data.generated_by_ai,
        school_today(db, user.school_id),
    )
    record(
        db,
        user_id=user.id,
        action="comment.create",
        success=True,
        object_type="student",
        object_id=str(student_id),
        request=request,
    )
    if not created:
        response.status_code = 200
    author = user
    if comment.created_by_user_id not in (None, user.id):
        author = db.get(User, comment.created_by_user_id) or user
    out = service.comment_out(comment, author, year.id, bindings, scope)
    db.commit()
    return out


@router.post("/classes/{class_id}/comments/bulk", status_code=201)
def create_bulk(
    class_id: UUID,
    data: CommentBulk,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> CommentBulkResult:
    cls = get_class_or_404(db, class_id)
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_WRITE, class_scope_of(cls),
        object_id=str(class_id),
    )  # fmt: skip
    year = require_active_year(db, cls.school_id)
    created = service.create_bulk(
        db,
        class_id,
        year,
        user,
        data.items,
        data.generated_by_ai,
        school_today(db, cls.school_id),
    )
    record(
        db,
        user_id=user.id,
        action="comment.create",
        success=True,
        object_type="class",
        object_id=str(class_id),
        request=request,
        extra={"count": created, "generated_by_ai": data.generated_by_ai},
    )
    db.commit()
    return CommentBulkResult(created=created)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    year = require_active_year(db, user.school_id)
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise ApiError(404, "NOT_FOUND", "评语不存在")
    if comment.academic_year_id != year.id:
        raise ApiError(409, "RECORD_READONLY", "往年的评语只读,不能删除")
    cls = get_class_or_404(db, comment.class_id)
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_WRITE, class_scope_of(cls),
        object_id=str(comment_id), object_type="comment",
    )  # fmt: skip
    db.delete(comment)
    record(
        db,
        user_id=user.id,
        action="comment.delete",
        success=True,
        object_type="comment",
        object_id=str(comment_id),
        request=request,
    )
    db.commit()
    return Response(status_code=204)
