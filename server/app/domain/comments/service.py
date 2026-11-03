from collections.abc import Sequence
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.comments.schemas import CommentOut
from app.errors import ApiError
from app.models import AcademicYear, Comment, Enrollment, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import Perm


def semester_of(year: AcademicYear, today: date) -> str:
    first = today.month >= 8 or today.month == 1
    return f"{year.name} {'第一学期' if first else '第二学期'}"


def can_delete_comment(
    comment: Comment, current_year_id: UUID, bindings: Sequence[Binding], scope: Scope
) -> bool:
    return comment.academic_year_id == current_year_id and can(bindings, Perm.COMMENT_WRITE, scope)


def _out(comment: Comment, author: str | None, current_year_id: UUID, can_del: bool) -> CommentOut:
    return CommentOut(
        id=comment.id,
        semester=comment.semester,
        content=comment.content,
        generated_by_ai=comment.generated_by_ai,
        current_year=comment.academic_year_id == current_year_id,
        created_by_name=author,
        can_delete=can_del,
        created_at=comment.created_at,
    )


def list_comments(
    db: Session,
    student_id: UUID,
    current_year_id: UUID,
    bindings: Sequence[Binding],
    scope: Scope,
) -> list[CommentOut]:
    rows = db.execute(
        select(Comment, User.display_name)
        .outerjoin(User, User.id == Comment.created_by_user_id)
        .where(Comment.student_id == student_id)
        .order_by(Comment.created_at.desc(), Comment.id)
    ).all()
    return [
        _out(c, a, current_year_id, can_delete_comment(c, current_year_id, bindings, scope))
        for c, a in rows
    ]


def create_comment(
    db: Session,
    student_id: UUID,
    enrollment: Enrollment,
    year: AcademicYear,
    user: User,
    content: str,
    generated_by_ai: bool,
    today: date,
) -> Comment:
    comment = Comment(
        student_id=student_id,
        enrollment_id=enrollment.id,
        class_id=enrollment.class_id,
        academic_year_id=year.id,
        semester=semester_of(year, today),
        content=content,
        generated_by_ai=generated_by_ai,
        created_by_user_id=user.id,
    )
    db.add(comment)
    db.flush()
    db.refresh(comment)
    return comment


def comment_out(
    comment: Comment, user: User, current_year_id: UUID, bindings: Sequence[Binding], scope: Scope
) -> CommentOut:
    return _out(
        comment,
        user.display_name,
        current_year_id,
        can_delete_comment(comment, current_year_id, bindings, scope),
    )


def create_bulk(
    db: Session,
    class_id: UUID,
    year: AcademicYear,
    user: User,
    items: Sequence,
    generated_by_ai: bool,
    today: date,
) -> int:
    ids = {i.student_id for i in items}
    enrollments = {
        e.student_id: e
        for e in db.scalars(
            select(Enrollment).where(
                Enrollment.class_id == class_id,
                Enrollment.academic_year_id == year.id,
                Enrollment.status == "active",
                Enrollment.student_id.in_(ids),
            )
        )
    }
    if any(i.student_id not in enrollments for i in items):
        raise ApiError(400, "AI_FIELD_INVALID", "有学生不在本班", {"field": "items"})
    semester = semester_of(year, today)
    for i in items:
        db.add(
            Comment(
                student_id=i.student_id,
                enrollment_id=enrollments[i.student_id].id,
                class_id=class_id,
                academic_year_id=year.id,
                semester=semester,
                content=i.content,
                generated_by_ai=generated_by_ai,
                created_by_user_id=user.id,
            )
        )
    db.flush()
    return len(items)
