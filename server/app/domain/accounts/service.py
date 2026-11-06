from collections import defaultdict
from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from redis import Redis
from sqlalchemy import and_, exists, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth import sessions
from app.auth.passwords import generate_temp_password, hash_password, hash_passwords
from app.auth.service import _fail_key
from app.config import Settings
from app.domain.accounts.importer import MAX_ROWS, parse_csv
from app.domain.accounts.schemas import (
    Account,
    AccountCreate,
    AccountInput,
    AccountPage,
    ImportedAccount,
    ImportRow,
    RoleTag,
)
from app.errors import ApiError
from app.models import Grade, RoleBinding, SchoolClass, User
from app.rbac.admin import account_admin_count
from app.rbac.roles import PARENT_ROLES, Role
from app.ws.hub import publish

PAGE_SIZE = 50

_PARENT_ROLE_VALUES = [r.value for r in PARENT_ROLES]

_SCHOOL_LABELS = {
    Role.principal.value: "校长",
    Role.dean.value: "教导主任",
    Role.it_admin.value: "信息中心",
}


def _binding_year_ok(year_id: UUID | None):
    ok = RoleBinding.academic_year_id.is_(None)
    return or_(ok, RoleBinding.academic_year_id == year_id) if year_id else ok


def role_tags(
    db: Session, user_ids: Sequence[UUID], year_id: UUID | None
) -> dict[UUID, list[RoleTag]]:
    result: dict[UUID, list[RoleTag]] = defaultdict(list)
    if not user_ids:
        return result
    bindings = db.scalars(
        select(RoleBinding)
        .where(
            RoleBinding.user_id.in_(user_ids),
            RoleBinding.ended_at.is_(None),
            _binding_year_ok(year_id),
        )
        .order_by(RoleBinding.started_at, RoleBinding.id)
    ).all()
    class_ids = {UUID(b.scope["class_id"]) for b in bindings if b.scope.get("class_id")}
    grade_ids = {UUID(b.scope["grade_id"]) for b in bindings if b.scope.get("grade_id")}
    classes = (
        dict(
            db.execute(
                select(SchoolClass.id, SchoolClass.name).where(SchoolClass.id.in_(class_ids))
            ).all()
        )
        if class_ids
        else {}
    )
    grades = (
        dict(db.execute(select(Grade.id, Grade.name).where(Grade.id.in_(grade_ids))).all())
        if grade_ids
        else {}
    )
    parents: set[UUID] = set()
    for b in bindings:
        if b.role_type in _PARENT_ROLE_VALUES:
            if b.user_id not in parents:
                parents.add(b.user_id)
                result[b.user_id].append(RoleTag(role="parent", label="家长"))
            continue
        label = _label(b, classes, grades)
        if label is not None:
            result[b.user_id].append(RoleTag(role=b.role_type, label=label))
    return result


def _label(b: RoleBinding, classes: dict[UUID, str], grades: dict[UUID, str]) -> str | None:
    if b.role_type in _SCHOOL_LABELS:
        return _SCHOOL_LABELS[b.role_type]
    scope = b.scope or {}
    class_name = classes.get(UUID(scope["class_id"])) if scope.get("class_id") else None
    if b.role_type == Role.grade_head.value:
        grade_name = grades.get(UUID(scope["grade_id"])) if scope.get("grade_id") else None
        return f"{grade_name} 组长" if grade_name else None
    if class_name is None:
        return None
    if b.role_type == Role.homeroom_teacher.value:
        return f"{class_name} 班主任"
    if b.role_type == Role.assistant_teacher.value:
        return f"{class_name} 副班主任"
    if b.role_type == Role.subject_teacher.value:
        return f"{class_name} {scope.get('subject') or '任课'}老师"
    return None


def _teacher_fields(
    db: Session, user_ids: Sequence[UUID]
) -> dict[UUID, tuple[str | None, list[str]]]:
    if not user_ids:
        return {}
    rows = db.execute(
        text("SELECT user_id, employee_no, subjects FROM teachers WHERE user_id = ANY(:ids)"),
        {"ids": list(user_ids)},
    ).all()
    return {r.user_id: (r.employee_no, list(r.subjects or [])) for r in rows}


def _views(db: Session, users: Sequence[User], year_id: UUID | None) -> list[Account]:
    ids = [u.id for u in users]
    tags = role_tags(db, ids, year_id)
    teachers = _teacher_fields(db, ids)
    return [
        Account(
            id=u.id,
            login_name=u.login_name,
            display_name=u.display_name,
            phone=u.phone,
            employee_no=teachers.get(u.id, (None, []))[0],
            subjects=teachers.get(u.id, (None, []))[1],
            status=u.status,
            must_change_password=u.must_change_password,
            last_login_at=u.last_login_at,
            roles=tags.get(u.id, []),
        )
        for u in users
    ]


def account_view(db: Session, user: User, year_id: UUID | None) -> Account:
    return _views(db, [user], year_id)[0]


def _escape_like(raw: str) -> str:
    return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_accounts(
    db: Session,
    school_id: UUID,
    year_id: UUID | None,
    q: str | None,
    role: str | None,
    status: str | None,
    page: int,
) -> AccountPage:
    conds = [User.school_id == school_id]
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        conds.append(
            or_(
                User.display_name.ilike(like, escape="\\"), User.login_name.ilike(like, escape="\\")
            )
        )
    if status:
        conds.append(User.status == status)
    if role:
        role_cond = (
            RoleBinding.role_type.in_(_PARENT_ROLE_VALUES)
            if role == "parent"
            else RoleBinding.role_type == role
        )
        conds.append(
            exists().where(
                and_(
                    RoleBinding.user_id == User.id,
                    role_cond,
                    RoleBinding.ended_at.is_(None),
                    _binding_year_ok(year_id),
                )
            )
        )
    total = db.scalar(select(func.count()).select_from(User).where(*conds)) or 0
    users = db.scalars(
        select(User)
        .where(*conds)
        .order_by(User.display_name, User.login_name)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    return AccountPage(items=_views(db, users, year_id), total=total)


def get_account_or_404(db: Session, school_id: UUID, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None or user.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "账号不存在")
    return user


def _existing_logins(db: Session, school_id: UUID) -> set[str]:
    return {
        n.lower() for n in db.scalars(select(User.login_name).where(User.school_id == school_id))
    }


def _insert_user(db: Session, school_id: UUID, data: AccountCreate, password_hash: str) -> User:
    user = User(
        school_id=school_id,
        login_name=data.login_name,
        password_hash=password_hash,
        display_name=data.display_name,
        phone=data.phone,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    db.execute(
        text("INSERT INTO teachers (user_id, employee_no, subjects) VALUES (:uid, :no, :subs)"),
        {"uid": user.id, "no": data.employee_no, "subs": data.subjects},
    )
    return user


def create_account(
    db: Session,
    school_id: UUID,
    year_id: UUID | None,
    actor: User,
    data: AccountCreate,
    request: Request | None,
) -> tuple[Account, str]:
    if data.login_name.lower() in _existing_logins(db, school_id):
        raise ApiError(409, "LOGIN_TAKEN", "登录名已被使用")
    temp = generate_temp_password()
    try:
        with db.begin_nested():
            user = _insert_user(db, school_id, data, hash_password(temp))
    except IntegrityError:
        raise ApiError(409, "LOGIN_TAKEN", "登录名已被使用") from None
    record(
        db,
        user_id=actor.id,
        action="account.create",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    return account_view(db, user, year_id), temp


def update_account(
    db: Session,
    year_id: UUID | None,
    actor: User,
    user: User,
    data: AccountInput,
    request: Request | None,
) -> Account:
    user.display_name = data.display_name
    user.phone = data.phone
    has_row = db.scalar(text("SELECT 1 FROM teachers WHERE user_id = :uid"), {"uid": user.id})
    if has_row or data.employee_no or data.subjects:  # 纯家长账号改姓名电话不建教职工行
        db.execute(
            text(
                "INSERT INTO teachers (user_id, employee_no, subjects) VALUES (:uid, :no, :subs) "
                "ON CONFLICT (user_id) DO UPDATE SET employee_no = :no, subjects = :subs"
            ),
            {"uid": user.id, "no": data.employee_no, "subs": data.subjects},
        )
    record(
        db,
        user_id=actor.id,
        action="account.update",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    return account_view(db, user, year_id)


def reset_password(
    db: Session,
    redis: Redis,
    settings: Settings,
    actor: User,
    user: User,
    request: Request | None,
) -> str:
    if actor.id == user.id:
        raise ApiError(409, "CANNOT_RESET_SELF", "不能重置自己的密码，请用修改密码")
    temp = generate_temp_password()
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    record(
        db,
        user_id=actor.id,
        action="account.reset_password",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    sessions.revoke_all(redis, user.id)
    redis.delete(_fail_key(settings, user.login_name))
    return temp


def _is_account_admin(db: Session, user_id: UUID) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(RoleBinding)
            .where(
                RoleBinding.user_id == user_id,
                RoleBinding.ended_at.is_(None),
                RoleBinding.role_type.in_([Role.principal.value, Role.it_admin.value]),
            )
        )
        or 0
    ) > 0


def freeze(
    db: Session,
    redis: Redis,
    year_id: UUID | None,
    actor: User,
    user: User,
    request: Request | None,
) -> Account:
    if actor.id == user.id:
        raise ApiError(409, "CANNOT_FREEZE_SELF", "不能冻结自己的账号")
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k)::bigint)"),
        {"k": f"last-admin:{user.school_id}"},
    )
    if user.status == "active" and _is_account_admin(db, user.id):
        if account_admin_count(db, user.school_id) - 1 < 1:
            raise ApiError(409, "LAST_ADMIN", "不能冻结最后一个能管账号的人")
    user.status = "frozen"
    record(
        db,
        user_id=actor.id,
        action="account.freeze",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    sessions.revoke_all(redis, user.id)
    publish(redis, [user.id], {"type": "session.revoked"})
    return account_view(db, user, year_id)


def unfreeze(
    db: Session, year_id: UUID | None, actor: User, user: User, request: Request | None
) -> Account:
    user.status = "active"
    record(
        db,
        user_id=actor.id,
        action="account.unfreeze",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    return account_view(db, user, year_id)


def preview_import(db: Session, school_id: UUID, csv_text: str) -> list[ImportRow]:
    return parse_csv(csv_text, _existing_logins(db, school_id))


def import_accounts(
    db: Session, school_id: UUID, actor: User, csv_text: str, request: Request | None
) -> list[ImportedAccount]:
    rows = preview_import(db, school_id, csv_text)
    if not rows:
        raise ApiError(400, "IMPORT_INVALID", "没有可导入的行")
    if len(rows) > MAX_ROWS:
        raise ApiError(400, "IMPORT_INVALID", f"单次最多导入 {MAX_ROWS} 行")
    errors = [r for r in rows if r.error]
    if errors:
        raise ApiError(
            400,
            "IMPORT_INVALID",
            "导入文件有错误,请修正后重试",
            {"rows": [r.model_dump() for r in errors]},
        )
    created: list[ImportedAccount] = []
    temps = [generate_temp_password() for _ in rows]
    hashes = hash_passwords(temps)
    for r, temp, pw_hash in zip(rows, temps, hashes, strict=True):
        data = AccountCreate(
            login_name=r.login_name,
            display_name=r.display_name,
            phone=r.phone,
            employee_no=r.employee_no,
            subjects=r.subjects,
        )
        try:
            with db.begin_nested():
                _insert_user(db, school_id, data, pw_hash)
        except IntegrityError:
            db.rollback()
            bad = r.model_copy(update={"error": "登录名已被使用"})
            raise ApiError(
                400,
                "IMPORT_INVALID",
                "导入文件有错误,请修正后重试",
                {"rows": [bad.model_dump()]},
            ) from None
        created.append(
            ImportedAccount(
                login_name=r.login_name, display_name=r.display_name, temp_password=temp
            )
        )
    record(
        db,
        user_id=actor.id,
        action="account.import",
        success=True,
        object_type="user",
        object_id=str(school_id),
        request=request,
        extra={"count": len(created)},
    )
    db.commit()
    return created
