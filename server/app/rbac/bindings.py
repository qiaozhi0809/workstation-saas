from collections.abc import Collection, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import RoleBinding
from app.rbac.roles import ROLE_PERMS, Perm, Role

# Most specific first.
_SCOPE_FIELDS = ("student_id", "class_id", "grade_id", "school_id")


@dataclass(frozen=True)
class Scope:
    school_id: UUID | None = None
    grade_id: UUID | None = None
    class_id: UUID | None = None
    student_id: UUID | None = None


@dataclass(frozen=True)
class Binding:
    role: Role
    scope: Scope
    academic_year_id: UUID | None
    subject: str | None = None


def covers(binding_scope: Scope, target: Scope) -> bool:
    for field in _SCOPE_FIELDS:
        value = getattr(binding_scope, field)
        if value is not None:
            return value == getattr(target, field)
    return False


def can(bindings: Sequence[Binding], perm: Perm, target: Scope) -> bool:
    return any(perm in ROLE_PERMS[bd.role] and covers(bd.scope, target) for bd in bindings)


def _scope_from_json(raw: dict) -> Scope:
    return Scope(**{f: UUID(raw[f]) if raw.get(f) else None for f in _SCOPE_FIELDS})


def load_bindings(db: Session, user_id: UUID, active_year_id: UUID | None) -> list[Binding]:
    year_ok = RoleBinding.academic_year_id.is_(None)
    if active_year_id is not None:
        year_ok = or_(year_ok, RoleBinding.academic_year_id == active_year_id)
    rows = db.scalars(
        select(RoleBinding)
        .where(
            RoleBinding.user_id == user_id,
            RoleBinding.ended_at.is_(None),
            year_ok,
        )
        .order_by(RoleBinding.started_at, RoleBinding.id)
    ).all()
    return [
        Binding(
            Role(r.role_type),
            _scope_from_json(r.scope or {}),
            r.academic_year_id,
            _subject_from_json(r.scope or {}),
        )
        for r in rows
    ]


def _subject_from_json(raw: dict) -> str | None:
    value = raw.get("subject")
    return value if isinstance(value, str) and value else None


def subjects_in_class(bindings: Sequence[Binding], class_id: UUID) -> list[str]:
    return sorted(
        {
            bd.subject
            for bd in bindings
            if bd.role is Role.subject_teacher and bd.scope.class_id == class_id and bd.subject
        }
    )


def has_role_in_class(bindings: Sequence[Binding], class_id: UUID, roles: Collection[Role]) -> bool:
    return any(bd.role in roles and bd.scope.class_id == class_id for bd in bindings)
