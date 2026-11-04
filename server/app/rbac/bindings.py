from collections.abc import Collection, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import RoleBinding
from app.rbac.roles import PARENT_ROLES, ROLE_PERMS, TEACHER_ROLES, Perm, Role

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


def load_bindings(
    db: Session,
    user_id: UUID,
    active_year_id: UUID | None,
    *,
    include_parents: bool = False,
) -> list[Binding]:
    # 家长绑定默认不加载:教师 / 管理端所有接口经 get_bindings 判权,家长不能借学生作用域的
    # 绑定走进这些接口(会绕过学校开关、"家长可见"过滤与 parent.view 审计)。
    # 家长只走 /parent/*,那里用 domain/parents/access.py 按绑定行判定。
    # 只有身份语境(user_brief → contexts_of)需要看到家长绑定,显式传 include_parents=True。
    # 教师岗位(班主任/任课/副班主任)按学年任职,与 list_my_classes 只认当前学年一致:
    # academic_year_id 为 NULL 的教师绑定不加载,避免它绕过学年边界拿到班级权限。
    # 管理岗(校长、教导主任、年级组长、信息中心)的学校/年级作用域绑定允许 NULL 学年,照旧加载。
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
        if not (Role(r.role_type) in TEACHER_ROLES and r.academic_year_id is None)
        and (include_parents or Role(r.role_type) not in PARENT_ROLES)
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


def _subjects_for(bindings: Sequence[Binding], scope: Scope, perm: Perm) -> frozenset[str] | None:
    if any(
        bd.role is not Role.subject_teacher
        and perm in ROLE_PERMS[bd.role]
        and covers(bd.scope, scope)
        for bd in bindings
    ):
        return None
    if scope.class_id is None:
        return frozenset()
    return frozenset(subjects_in_class(bindings, scope.class_id))


def visible_subjects(bindings: Sequence[Binding], scope: Scope) -> frozenset[str] | None:
    """None = every subject; otherwise only the caller's own subjects."""
    return _subjects_for(bindings, scope, Perm.EXAM_READ)


def writable_subjects(bindings: Sequence[Binding], scope: Scope) -> frozenset[str] | None:
    return _subjects_for(bindings, scope, Perm.SCORE_WRITE)
