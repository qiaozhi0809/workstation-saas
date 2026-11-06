from uuid import UUID

from sqlalchemy import literal_column, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.auth.service import contexts_of
from app.domain.preferences.schemas import Preferences, ReviewReason
from app.domain.schools.service import active_academic_year
from app.errors import ApiError
from app.models import User, UserPreference
from app.rbac.bindings import load_bindings

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
        onboarded={},
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
        onboarded=row.onboarded,
    )


def _own_contexts(db: Session, user: User) -> set[str]:
    """调用者拥有的语境;家长绑定也算(get_bindings 默认不含,这里显式带上)。"""
    year = active_academic_year(db, user.school_id)
    bindings = load_bindings(db, user.id, year.id if year else None, include_parents=True)
    return set(contexts_of(bindings))


def save_preferences(db: Session, user: User, prefs: Preferences) -> Preferences:
    """整行 upsert;onboarded 例外:None 不动,否则只合并给出的键(JSONB ||)。"""
    values = {
        "teacher_figure": prefs.teacher_figure,
        "idle_animation": prefs.idle_animation,
        "review_reasons": [r.model_dump() for r in prefs.review_reasons],
    }
    merge = None
    if prefs.onboarded is not None:
        unknown = set(prefs.onboarded) - _own_contexts(db, user)
        if unknown:
            raise ApiError(
                400,
                "BAD_REQUEST",
                "只能记录自己拥有的身份语境",
                {"contexts": sorted(unknown)},
            )
        merge = {k: v.isoformat() for k, v in prefs.onboarded.items()}
    insert_values = dict(values)
    if merge is not None:
        insert_values["onboarded"] = merge
    stmt = postgresql.insert(UserPreference).values(user_id=user.id, **insert_values)
    set_ = {**values, "updated_at": stmt.excluded.updated_at}
    if merge is not None:
        set_["onboarded"] = literal_column("user_preferences.onboarded || excluded.onboarded")
    stmt = stmt.on_conflict_do_update(index_elements=[UserPreference.user_id], set_=set_)
    db.execute(stmt)
    db.commit()
    return get_preferences(db, user.id)
