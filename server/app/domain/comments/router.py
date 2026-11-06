from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.audit.service import deny, record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.comments import service
from app.domain.comments.schemas import (
    CommentBulk,
    CommentBulkResult,
    CommentInput,
    CommentOut,
    ParentVisibleInput,
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


@router.put("/comments/{comment_id}/parent-visible")
def set_parent_visible(
    comment_id: UUID,
    data: ParentVisibleInput,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> CommentOut:
    year = require_active_year(db, user.school_id)
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise ApiError(404, "NOT_FOUND", "评语不存在")
    cls = get_class_or_404(db, comment.class_id)
    scope = class_scope_of(cls)
    # "给家长看"由学生**当前**在读班的班主任切换(L69 / L70):往年的班在当前学年没有任何绑定,
    # 年内转班也跟着学生走;学生没有在读班时谁也不能切(审计记 comment.write 被拒)
    found = find_enrolled_student(db, comment.student_id, year.id)
    if found is None:
        deny(
            db,
            user_id=user.id,
            action=Perm.COMMENT_WRITE.value,
            object_type="comment",
            object_id=str(comment_id),
            request=request,
        )
    _, current_scope, _ = found
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_WRITE, current_scope,
        object_id=str(comment_id), object_type="comment",
    )  # fmt: skip
    out = service.set_parent_visible(
        db,
        user,
        comment,
        data.visible,
        request,
        bindings=bindings,
        current_year_id=year.id,
        scope=scope,
        current_scope=current_scope,
    )
    db.commit()
    return out


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    # 判定顺序:404(不存在)→ 403(无权限,写审计)→ 409(往年只读),L97
    year = require_active_year(db, user.school_id)
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise ApiError(404, "NOT_FOUND", "评语不存在")
    cls = get_class_or_404(db, comment.class_id)
    ensure(
        db, request, user.id, bindings, Perm.COMMENT_WRITE, class_scope_of(cls),
        object_id=str(comment_id), object_type="comment",
    )  # fmt: skip
    if comment.academic_year_id != year.id:
        raise ApiError(409, "RECORD_READONLY", "往年的评语只读,不能删除")
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
