from collections.abc import Sequence
from datetime import date
from uuid import UUID

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.classes.service import class_scope_of
from app.domain.comments.schemas import CommentOut
from app.domain.school_settings.service import get_switches
from app.errors import ApiError
from app.models import AcademicYear, Comment, Enrollment, SchoolClass, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import Perm


def semester_of(year: AcademicYear, today: date) -> str:
    if year.term2_start is not None:
        first = today < year.term2_start
    else:
        first = today.month >= 8 or today.month == 1
    return f"{year.name} {'第一学期' if first else '第二学期'}"


def can_delete_comment(
    comment: Comment, current_year_id: UUID, bindings: Sequence[Binding], scope: Scope
) -> bool:
    """scope 必须是评语所在班(comment.class_id)的范围,与 DELETE 端点的校验一致。"""
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
        parent_visible=comment.parent_visible,
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
    scopes: dict[UUID, Scope] = {}
    for c, _ in rows:
        if c.class_id not in scopes:
            cls = db.get(SchoolClass, c.class_id)
            scopes[c.class_id] = class_scope_of(cls) if cls is not None else scope
    return [
        _out(
            c,
            a,
            current_year_id,
            can_delete_comment(c, current_year_id, bindings, scopes[c.class_id]),
        )
        for c, a in rows
    ]


def _default_parent_visible(db: Session, school_id: UUID, generated_by_ai: bool) -> bool:
    """AI 生成的评语在"发给家长前先审阅"开着时默认不给家长看。开关每次现读。"""
    return not (generated_by_ai and get_switches(db, school_id).ai_review_before_send)


def set_parent_visible(
    db: Session,
    actor: User,
    comment: Comment,
    visible: bool,
    request: Request | None,
    *,
    bindings: Sequence[Binding],
    current_year_id: UUID,
    scope: Scope,
) -> CommentOut:
    """调用方已校验该评语所在班的 comment.write;不提交。"""
    comment.parent_visible = visible
    record(
        db,
        user_id=actor.id,
        action="comment.share" if visible else "comment.unshare",
        success=True,
        object_type="comment",
        object_id=str(comment.id),
        request=request,
    )
    author = actor
    if comment.created_by_user_id not in (None, actor.id):
        author = db.get(User, comment.created_by_user_id) or actor
    name = author.display_name if comment.created_by_user_id is not None else None
    return _out(
        comment,
        name,
        current_year_id,
        can_delete_comment(comment, current_year_id, bindings, scope),
    )


def _insert_ignoring_duplicates(db: Session, values: dict) -> Comment | None:
    """同一学生、同一学期、内容逐字相同的评语只存一条;冲突时返回 None。"""
    stmt = (
        insert(Comment)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=[Comment.enrollment_id, Comment.semester, func.md5(Comment.content)]
        )
        .returning(Comment.id)
    )
    new_id = db.execute(stmt).scalar_one_or_none()
    return None if new_id is None else db.get(Comment, new_id)


def create_comment(
    db: Session,
    student_id: UUID,
    enrollment: Enrollment,
    year: AcademicYear,
    user: User,
    content: str,
    generated_by_ai: bool,
    today: date,
) -> tuple[Comment, bool]:
    """返回 (评语, 是否新建);已有相同评语时返回那一条。"""
    semester = semester_of(year, today)
    comment = _insert_ignoring_duplicates(
        db,
        {
            "student_id": student_id,
            "enrollment_id": enrollment.id,
            "class_id": enrollment.class_id,
            "academic_year_id": year.id,
            "semester": semester,
            "content": content,
            "generated_by_ai": generated_by_ai,
            "parent_visible": _default_parent_visible(db, user.school_id, generated_by_ai),
            "created_by_user_id": user.id,
        },
    )
    if comment is not None:
        db.refresh(comment)
        return comment, True
    existing = db.scalars(
        select(Comment).where(
            Comment.enrollment_id == enrollment.id,
            Comment.semester == semester,
            func.md5(Comment.content) == func.md5(content),
        )
    ).one()
    return existing, False


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
    visible = _default_parent_visible(db, user.school_id, generated_by_ai)
    created = 0
    for i in items:
        row = _insert_ignoring_duplicates(
            db,
            {
                "student_id": i.student_id,
                "enrollment_id": enrollments[i.student_id].id,
                "class_id": class_id,
                "academic_year_id": year.id,
                "semester": semester,
                "content": i.content,
                "generated_by_ai": generated_by_ai,
                "parent_visible": visible,
                "created_by_user_id": user.id,
            },
        )
        if row is not None:
            created += 1
    return created
