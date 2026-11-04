"""班主任管家长账号:建 / 绑 / 调主次 / 解绑 / 重置密码。

权限是学生当前在读注册所在班的 parent.manage。所有写操作先 SELECT … FOR UPDATE 锁学生行,
再判定与改写;令牌作废放在事务提交之后。
"""

import re
from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from redis import Redis
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny, record
from app.auth import sessions
from app.auth.passwords import generate_temp_password, hash_password
from app.auth.service import _fail_key
from app.config import Settings
from app.domain.classes.service import class_scope_of
from app.domain.parents.lifecycle import archive_orphan_accounts
from app.domain.parents.schemas import ParentCreated, ParentInput, ParentOfStudent
from app.errors import ApiError
from app.models import Enrollment, RoleBinding, SchoolClass, Student, User
from app.models.parents import Parent, ParentLink
from app.rbac.bindings import Binding, can
from app.rbac.roles import PARENT_ROLES, Perm, Role

MAX_PARENTS = 4
_PHONE_RE = re.compile(r"^[0-9]{11}$")
_PARENT_ROLE_VALUES = sorted(r.value for r in PARENT_ROLES)


def _role_for(is_primary: bool) -> str:
    return (Role.primary_parent if is_primary else Role.secondary_parent).value


def lock_student(db: Session, school_id: UUID, student_id: UUID) -> Student:
    student = db.scalar(select(Student).where(Student.id == student_id).with_for_update())
    if student is None or student.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    return student


def authorize(
    db: Session,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    student: Student,
) -> None:
    """学生当前在读注册所在班的 parent.manage;没有在读注册 → 403 + 审计。"""
    cls = db.scalar(
        select(SchoolClass)
        .join(Enrollment, Enrollment.class_id == SchoolClass.id)
        .where(Enrollment.student_id == student.id, Enrollment.status == "active")
        .limit(1)
    )
    if cls is None or not can(bindings, Perm.PARENT_MANAGE, class_scope_of(cls)):
        deny(
            db,
            user_id=actor.id,
            action=Perm.PARENT_MANAGE.value,
            object_type="student",
            object_id=str(student.id),
            request=request,
        )


def _live_link_or_404(db: Session, link_id: UUID) -> ParentLink:
    link = db.get(ParentLink, link_id)
    if link is None or link.status == "ended":
        raise ApiError(404, "NOT_FOUND", "家长绑定不存在")
    return link


def open_link(
    db: Session,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    link_id: UUID,
) -> tuple[ParentLink, Student]:
    """找绑定 → 锁学生行 → 判权;锁住后重读绑定(别的请求可能刚把它解绑)。"""
    link = db.get(ParentLink, link_id)
    if link is None:
        raise ApiError(404, "NOT_FOUND", "家长绑定不存在")
    student = lock_student(db, actor.school_id, link.student_id)
    authorize(db, request, actor, bindings, student)
    db.refresh(link)
    return _live_link_or_404(db, link_id), student


def _views(db: Session, links: Sequence[ParentLink]) -> list[ParentOfStudent]:
    if not links:
        return []
    rows = db.execute(
        select(Parent, User)
        .join(User, User.id == Parent.user_id)
        .where(Parent.id.in_([lk.parent_id for lk in links]))
    ).all()
    by_parent = {p.id: (p, u) for p, u in rows}
    staff = {
        r.user_id
        for r in db.execute(
            text("SELECT user_id FROM teachers WHERE user_id = ANY(:ids)"),
            {"ids": [u.id for _, u in rows]},
        )
    }
    out = []
    for lk in links:
        parent, user = by_parent[lk.parent_id]
        out.append(
            ParentOfStudent(
                link_id=lk.id,
                user_id=user.id,
                name=parent.name,
                relation=lk.relation or "其他",
                phone=parent.phone or user.phone or user.login_name,
                is_primary=lk.is_primary,
                status=lk.status,
                account_status=user.status,
                shared_account=user.id in staff,
                must_change_password=user.must_change_password,
            )
        )
    return out


def _live_links(db: Session, student_id: UUID) -> list[ParentLink]:
    return list(
        db.scalars(
            select(ParentLink)
            .where(ParentLink.student_id == student_id, ParentLink.status != "ended")
            .order_by(ParentLink.is_primary.desc(), ParentLink.created_at, ParentLink.id)
            .execution_options(populate_existing=True)
        )
    )


def list_parents(db: Session, student: Student) -> list[ParentOfStudent]:
    return _views(db, _live_links(db, student.id))


def _find_account(db: Session, school_id: UUID, phone: str) -> User | None:
    users = list(
        db.scalars(
            select(User).where(
                User.school_id == school_id,
                or_(func.lower(User.login_name) == phone, User.phone == phone),
            )
        )
    )
    active = [u for u in users if u.status == "active"]
    if len(active) > 1:
        raise ApiError(409, "PHONE_AMBIGUOUS", "这个手机号对应多个账号,请联系信息中心")
    if active:
        return active[0]
    if any(u.login_name.lower() == phone for u in users):
        raise ApiError(409, "PHONE_TAKEN_INACTIVE", "这个手机号的账号已停用,请联系信息中心")
    return None


def _add_binding(db: Session, user_id: UUID, student_id: UUID, is_primary: bool) -> None:
    db.add(
        RoleBinding(
            user_id=user_id,
            role_type=_role_for(is_primary),
            scope={"student_id": str(student_id)},
            academic_year_id=None,
        )
    )
    db.flush()


def _set_binding_role(db: Session, user_id: UUID, student_id: UUID, is_primary: bool) -> None:
    db.execute(
        text(
            "UPDATE role_bindings SET role_type = :role WHERE user_id = :u AND ended_at IS NULL"
            " AND role_type = ANY(:roles) AND scope->>'student_id' = :sid"
        ),
        {
            "role": _role_for(is_primary),
            "u": user_id,
            "roles": _PARENT_ROLE_VALUES,
            "sid": str(student_id),
        },
    )


def _end_binding(db: Session, user_id: UUID, student_id: UUID) -> None:
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = now() WHERE user_id = :u AND ended_at IS NULL"
            " AND role_type = ANY(:roles) AND scope->>'student_id' = :sid"
        ),
        {"u": user_id, "roles": _PARENT_ROLE_VALUES, "sid": str(student_id)},
    )


def _set_flag(db: Session, link: ParentLink, is_primary: bool) -> None:
    """单独一条 UPDATE 改主次并立刻落库(部分唯一索引不可延迟,降级必须先于升级)。"""
    db.execute(
        ParentLink.__table__.update().where(ParentLink.id == link.id).values(is_primary=is_primary)
    )
    db.refresh(link)


def add_parent(
    db: Session,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    student_id: UUID,
    body: ParentInput,
) -> ParentCreated:
    student = lock_student(db, actor.school_id, student_id)
    authorize(db, request, actor, bindings, student)
    if not _PHONE_RE.fullmatch(body.phone):
        raise ApiError(400, "PHONE_INVALID", "手机号应为 11 位数字")
    phone = body.phone
    user = _find_account(db, actor.school_id, phone)
    parent = (
        db.scalar(select(Parent).where(Parent.user_id == user.id)) if user is not None else None
    )
    existing = (
        db.scalar(
            select(ParentLink).where(
                ParentLink.parent_id == parent.id, ParentLink.student_id == student.id
            )
        )
        if parent is not None
        else None
    )
    if existing is not None and existing.status != "ended":
        hint = "该家长已绑定这个孩子" + (
            ",当前为只读状态(孩子已不在读)" if existing.status == "readonly" else ""
        )
        raise ApiError(409, "PARENT_EXISTS", hint)
    live = _live_links(db, student.id)
    if len(live) >= MAX_PARENTS:
        raise ApiError(409, "PARENT_LIMIT", f"每个孩子最多 {MAX_PARENTS} 位家长")
    is_primary = not any(lk.is_primary for lk in live)

    temp: str | None = None
    if user is None:
        temp = generate_temp_password()
        try:
            with db.begin_nested():
                user = User(
                    school_id=actor.school_id,
                    login_name=phone,
                    password_hash=hash_password(temp),
                    display_name=body.name,
                    phone=phone,
                    must_change_password=True,
                )
                db.add(user)
                db.flush()
        except IntegrityError:
            raise ApiError(409, "PHONE_AMBIGUOUS", "这个手机号刚被占用,请重试") from None
    if parent is None:
        parent = Parent(user_id=user.id, name=body.name, phone=phone)
        db.add(parent)
        db.flush()

    if existing is not None:  # ended -> 恢复同一行
        db.execute(
            ParentLink.__table__.update()
            .where(ParentLink.id == existing.id)
            .values(
                status="active",
                ended_at=None,
                readonly_since=None,
                is_primary=is_primary,
                relation=body.relation,
                created_by_user_id=actor.id,
            )
        )
        db.refresh(existing)
        link = existing
    else:
        link = ParentLink(
            parent_id=parent.id,
            student_id=student.id,
            relation=body.relation,
            is_primary=is_primary,
            status="active",
            created_by_user_id=actor.id,
        )
        db.add(link)
        db.flush()
    _add_binding(db, user.id, student.id, is_primary)
    record(
        db,
        user_id=actor.id,
        action="parent.create" if temp is not None else "parent.link",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
        extra={"student_id": str(student.id), "link_id": str(link.id)},
    )
    view = _views(db, [link])[0]
    db.commit()
    return ParentCreated(parent=view, temp_password=temp)


def set_primary(
    db: Session,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    link_id: UUID,
) -> list[ParentOfStudent]:
    link, student = open_link(db, request, actor, bindings, link_id)
    if link.status != "active":
        raise ApiError(409, "PARENT_READONLY", "只读状态的家长不能设为主家长")
    if not link.is_primary:
        for old in _live_links(db, student.id):
            if old.is_primary:
                _set_flag(db, old, False)
                _set_binding_role(db, _user_of(db, old), student.id, False)
        _set_flag(db, link, True)
        _set_binding_role(db, _user_of(db, link), student.id, True)
        record(
            db,
            user_id=actor.id,
            action="parent.primary",
            success=True,
            object_type="user",
            object_id=str(_user_of(db, link)),
            request=request,
            extra={"student_id": str(student.id), "link_id": str(link.id)},
        )
    out = list_parents(db, student)
    db.commit()
    return out


def _user_of(db: Session, link: ParentLink) -> UUID:
    return db.scalars(select(Parent.user_id).where(Parent.id == link.parent_id)).one()


def unlink(
    db: Session,
    redis: Redis,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    link_id: UUID,
) -> None:
    link, student = open_link(db, request, actor, bindings, link_id)
    user_id = _user_of(db, link)
    was_primary = link.is_primary
    db.execute(
        ParentLink.__table__.update()
        .where(ParentLink.id == link.id)
        .values(status="ended", ended_at=clock.utc_now(), readonly_since=None, is_primary=False)
    )
    _end_binding(db, user_id, student.id)
    if was_primary:
        rest = _live_links(db, student.id)
        if rest:
            heir = min(rest, key=lambda lk: (lk.created_at, lk.id))
            _set_flag(db, heir, True)
            _set_binding_role(db, _user_of(db, heir), student.id, True)
    archived = archive_orphan_accounts(db, [user_id])
    record(
        db,
        user_id=actor.id,
        action="parent.unlink",
        success=True,
        object_type="user",
        object_id=str(user_id),
        request=request,
        extra={"student_id": str(student.id), "link_id": str(link.id)},
    )
    for uid in archived:
        record(
            db,
            user_id=actor.id,
            action="parent.archive",
            success=True,
            object_type="user",
            object_id=str(uid),
            request=request,
            extra={"via": "unlink"},
        )
    db.commit()
    for uid in archived:
        sessions.revoke_all(redis, uid)


def reset_parent_password(
    db: Session,
    redis: Redis,
    settings: Settings,
    request: Request | None,
    actor: User,
    bindings: Sequence[Binding],
    link_id: UUID,
) -> str:
    link, student = open_link(db, request, actor, bindings, link_id)
    user = db.get(User, _user_of(db, link))
    assert user is not None
    if _views(db, [link])[0].shared_account:
        raise ApiError(409, "PARENT_ACCOUNT_SHARED", "该账号也是教职工账号,请联系信息中心重置")
    if user.status != "active":
        raise ApiError(409, "ACCOUNT_NOT_ACTIVE", "该账号已停用,不能重置密码")
    temp = generate_temp_password()
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    record(
        db,
        user_id=actor.id,
        action="parent.reset",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
        extra={"student_id": str(student.id), "link_id": str(link.id)},
    )
    db.commit()
    sessions.revoke_all(redis, user.id)
    redis.delete(_fail_key(settings, user.login_name))
    return temp
