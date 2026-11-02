import base64
from collections.abc import Sequence
from datetime import date, datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import case, func, insert, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny, record
from app.domain.attendance.service import exceptions_on
from app.domain.reviews.schemas import (
    ReviewCreate,
    ReviewOut,
    ReviewPage,
    ReviewSummary,
    ReviewTotals,
    RevokeResult,
)
from app.domain.students.service import active_enrollments
from app.errors import ApiError
from app.models import Enrollment, Review, SchoolClass, Student
from app.rbac.bindings import Binding, has_role_in_class, subjects_in_class
from app.rbac.roles import Role


def _outs(db: Session, rows: Sequence[Review], user_id: UUID) -> list[ReviewOut]:
    """批量补全学生姓名与在读状态(一次查询,不逐行查)。"""
    ids = {r.enrollment_id for r in rows}
    info = (
        {
            eid: (name, status)
            for eid, name, status in db.execute(
                select(Enrollment.id, Student.name, Enrollment.status)
                .join(Student, Student.id == Enrollment.student_id)
                .where(Enrollment.id.in_(ids))
            )
        }
        if ids
        else {}
    )
    return [
        ReviewOut(
            id=r.id,
            op_id=r.op_id,
            enrollment_id=r.enrollment_id,
            category=r.category,  # type: ignore[arg-type]
            reason_text=r.reason_text,
            score_delta=r.score_delta,
            subject=r.subject,
            given_at=r.given_at,
            given_by_me=r.given_by_user_id == user_id,
            student_name=info[r.enrollment_id][0],
            transferred=info[r.enrollment_id][1] != "active",
        )
        for r in rows
    ]


def _existing(db: Session, cls: SchoolClass, user_id: UUID, op_id: UUID) -> list[ReviewOut] | None:
    rows = db.scalars(
        select(Review).where(Review.op_id == op_id).order_by(Review.enrollment_id)
    ).all()
    if not rows:
        return None
    if any(r.given_by_user_id != user_id or r.class_id != cls.id for r in rows):
        raise ApiError(409, "OP_ID_CONFLICT", "该操作编号已被使用")
    return _outs(db, [r for r in rows if r.revoked_at is None], user_id)


def _resolve_subject(bindings: list[Binding], class_id: UUID, requested: str | None) -> str | None:
    mine = subjects_in_class(bindings, class_id)
    if requested is not None:
        if requested not in mine:
            raise ApiError(400, "SUBJECT_NOT_ALLOWED", "不能以该科目点评")
        return requested
    if has_role_in_class(bindings, class_id, {Role.homeroom_teacher, Role.assistant_teacher}):
        return None
    if len(mine) == 1:
        return mine[0]
    raise ApiError(400, "SUBJECT_REQUIRED", "请选择点评科目")


def create_reviews(
    db: Session,
    cls: SchoolClass,
    bindings: list[Binding],
    user_id: UUID,
    body: ReviewCreate,
    today: date,
) -> tuple[list[ReviewOut], bool]:
    replay = _existing(db, cls, user_id, body.op_id)
    if replay is not None:
        return replay, False

    subject = _resolve_subject(bindings, cls.id, body.subject)

    enrollments = active_enrollments(db, cls.id)
    if body.category == "individual":
        active_ids = {e.id for e in enrollments}
        targets = sorted(body.enrollment_ids or [])
        if any(t not in active_ids for t in targets):
            raise ApiError(400, "UNKNOWN_ENROLLMENT", "包含不在本班在籍的学生")
    else:
        away = {
            eid
            for eid, status in exceptions_on(db, cls.id, today).items()
            if status in ("leave", "absent")
        }
        targets = sorted(e.id for e in enrollments if e.id not in away)
        if not targets:
            raise ApiError(400, "NO_TARGETS", "没有可点评的学生")

    given_at = clock.utc_now()
    try:
        db.execute(
            insert(Review),
            [
                {
                    "op_id": body.op_id,
                    "enrollment_id": t,
                    "class_id": cls.id,
                    "category": body.category,
                    "reason_text": body.reason_text,
                    "score_delta": body.score_delta,
                    "subject": subject,
                    "given_by_user_id": user_id,
                    "given_at": given_at,
                }
                for t in targets
            ],
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = _existing(db, cls, user_id, body.op_id)
        if replay is None:
            raise
        return replay, False

    rows = db.scalars(
        select(Review).where(Review.op_id == body.op_id).order_by(Review.enrollment_id)
    ).all()
    return _outs(db, rows, user_id), True


def _encode_cursor(row: Review) -> str:
    raw = f"{row.given_at.isoformat()}|{row.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        at, _, rid = raw.partition("|")
        return datetime.fromisoformat(at), UUID(rid)
    except Exception as exc:
        raise ApiError(400, "BAD_REQUEST", "分页游标无效") from exc


def list_reviews(
    db: Session, class_id: UUID, user_id: UUID, cursor: str | None, limit: int
) -> ReviewPage:
    stmt = (
        select(Review)
        .join(Enrollment, Enrollment.id == Review.enrollment_id)
        .where(
            Review.class_id == class_id,
            Review.revoked_at.is_(None),
            Enrollment.status != "removed",
        )
        .order_by(Review.given_at.desc(), Review.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        at, rid = _decode_cursor(cursor)
        if at.tzinfo is None:
            raise ApiError(400, "BAD_REQUEST", "分页游标无效")
        stmt = stmt.where(tuple_(Review.given_at, Review.id) < (at, rid))
    rows = list(db.scalars(stmt).all())
    page = rows[:limit]
    next_cursor = _encode_cursor(page[-1]) if len(rows) > limit else None
    return ReviewPage(items=_outs(db, page, user_id), next_cursor=next_cursor)


def summarize(
    db: Session, class_id: UUID, week_start_utc: datetime, week_start: date
) -> ReviewSummary:
    enrollments = active_enrollments(db, class_id)
    agg = {
        r.enrollment_id: r
        for r in db.execute(
            select(
                Review.enrollment_id,
                func.sum(Review.score_delta).label("total"),
                func.coalesce(
                    func.sum(
                        case((Review.given_at >= week_start_utc, Review.score_delta), else_=0)
                    ),
                    0,
                ).label("week"),
                func.count(case((Review.score_delta > 0, 1))).label("plus"),
                func.count(case((Review.score_delta < 0, 1))).label("minus"),
            )
            .where(Review.class_id == class_id, Review.revoked_at.is_(None))
            .group_by(Review.enrollment_id)
        )
    }
    items = []
    for e in enrollments:
        r = agg.get(e.id)
        items.append(
            ReviewTotals(
                enrollment_id=e.id,
                total=int(r.total) if r else 0,
                week=int(r.week) if r else 0,
                plus_count=r.plus if r else 0,
                minus_count=r.minus if r else 0,
            )
        )
    return ReviewSummary(week_start=week_start, items=items)


def revoke(
    db: Session, class_id: UUID, op_id: UUID, user_id: UUID, request: Request
) -> RevokeResult:
    givers = db.scalars(
        select(Review.given_by_user_id).where(Review.op_id == op_id, Review.class_id == class_id)
    ).all()
    if not givers:
        raise ApiError(404, "NOT_FOUND", "点评不存在")
    if any(g != user_id for g in givers):
        deny(
            db,
            user_id=user_id,
            action="review.revoke",
            object_type="review_op",
            object_id=str(op_id),
            request=request,
        )
    result = db.execute(
        update(Review)
        .where(
            Review.op_id == op_id,
            Review.class_id == class_id,
            Review.revoked_at.is_(None),
        )
        .values(revoked_at=clock.utc_now(), revoked_by_user_id=user_id)
    )
    count = result.rowcount
    if count > 0:
        record(
            db,
            user_id=user_id,
            action="review.revoke",
            success=True,
            object_type="review_op",
            object_id=str(op_id),
            request=request,
        )
    db.commit()
    return RevokeResult(op_id=op_id, revoked=count)
