from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.domain.preferences.schemas import Preferences, ReviewReason
from app.models import UserPreference

DEFAULT_REVIEW_REASONS: list[ReviewReason] = [
    ReviewReason(text=text, delta=delta)
    for text, delta in (
        ("积极发言", 1),
        ("作业优秀", 1),
        ("乐于助人", 1),
        ("值日认真", 1),
        ("考试进步", 2),
        ("为班争光", 3),
        ("上课走神", -1),
        ("作业未交", -1),
        ("迟到", -1),
        ("违反纪律", -2),
    )
]


def _defaults() -> Preferences:
    return Preferences(
        teacher_figure="female",
        idle_animation=True,
        review_reasons=[r.model_copy() for r in DEFAULT_REVIEW_REASONS],
    )


def get_preferences(db: Session, user_id: UUID) -> Preferences:
    row = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if row is None:
        return _defaults()
    reasons = (
        DEFAULT_REVIEW_REASONS
        if row.review_reasons is None
        else [ReviewReason.model_validate(r) for r in row.review_reasons]
    )
    return Preferences(
        teacher_figure=row.teacher_figure,  # type: ignore[arg-type]
        idle_animation=row.idle_animation,
        review_reasons=list(reasons),
    )


def save_preferences(db: Session, user_id: UUID, prefs: Preferences) -> Preferences:
    values = {
        "teacher_figure": prefs.teacher_figure,
        "idle_animation": prefs.idle_animation,
        "review_reasons": [r.model_dump() for r in prefs.review_reasons],
    }
    stmt = postgresql.insert(UserPreference).values(user_id=user_id, **values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[UserPreference.user_id],
        set_={**values, "updated_at": stmt.excluded.updated_at},
    )
    db.execute(stmt)
    db.commit()
    return get_preferences(db, user_id)
