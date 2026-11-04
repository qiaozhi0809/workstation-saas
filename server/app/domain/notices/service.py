from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from fastapi import Request
from redis import Redis
from sqlalchemy import CompoundSelect, Select, func, select, union, update
from sqlalchemy.orm import Session

from app.audit.service import deny, record
from app.domain.notices.schemas import (
    ClassTarget,
    GradeTarget,
    Inbox,
    InboxItem,
    NoticeInput,
    NoticePerson,
    NoticeRecipients,
    NoticeSent,
    NoticeSentPage,
    ReadRecipient,
    SchoolTarget,
    UnreadRecipient,
    UsersTarget,
)
from app.domain.schools.service import require_active_year
from app.errors import ApiError
from app.models import AcademicYear, Grade, Notice, NoticeRecipient, RoleBinding, SchoolClass, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.guard import ensure
from app.rbac.roles import ADMIN_ROLES, ROLE_PERMS, TEACHER_ROLES, Perm, Role
from app.ws.hub import publish

PAGE_SIZE = 20
PEOPLE_LIMIT = 20

_ADMIN_LABELS = {
    Role.principal.value: "校长",
    Role.dean.value: "教导主任",
    Role.it_admin.value: "信息中心",
}


# ---- 权限 ----


def _holds_send(bindings: Sequence[Binding]) -> bool:
    return any(Perm.NOTICE_SEND in ROLE_PERMS[bd.role] for bd in bindings)


def ensure_sender(
    db: Session, request: Request | None, user: User, bindings: Sequence[Binding]
) -> None:
    """持有任一 notice.send(学校或年级作用域)才能进入发件端点;没有则 403 并写拒绝审计。"""
    if not _holds_send(bindings):
        deny(
            db,
            user_id=user.id,
            action=Perm.NOTICE_SEND.value,
            object_type="school",
            object_id=str(user.school_id),
            request=request,
        )


def _school_wide(bindings: Sequence[Binding], school_id: UUID) -> bool:
    return can(bindings, Perm.NOTICE_SEND, Scope(school_id=school_id))


def _send_grades(bindings: Sequence[Binding]) -> set[UUID]:
    return {
        bd.scope.grade_id
        for bd in bindings
        if Perm.NOTICE_SEND in ROLE_PERMS[bd.role] and bd.scope.grade_id is not None
    }


# ---- 收件人口径(与 rbac/bindings.py::load_bindings 的学年规则一致) ----


def _teacher_ids(year_id: UUID, class_ids: Sequence[UUID] | None = None) -> Select:
    """当前学年、未结束的教师岗位绑定;学年为空的教师绑定不算。class_ids 为空表示不限班。"""
    stmt = select(RoleBinding.user_id).where(
        RoleBinding.role_type.in_([r.value for r in TEACHER_ROLES]),
        RoleBinding.academic_year_id == year_id,
        RoleBinding.ended_at.is_(None),
    )
    if class_ids is not None:
        stmt = stmt.where(RoleBinding.scope["class_id"].astext.in_([str(c) for c in class_ids]))
    return stmt


def _admin_ids(year_id: UUID, grade_ids: Sequence[UUID] | None = None) -> Select:
    """在任管理岗:绑定学年为空或等于当前学年;grade_ids 不为空时只取这些年级的组长。"""
    stmt = select(RoleBinding.user_id).where(
        RoleBinding.ended_at.is_(None),
        RoleBinding.academic_year_id.is_(None) | (RoleBinding.academic_year_id == year_id),
    )
    if grade_ids is None:
        return stmt.where(RoleBinding.role_type.in_([r.value for r in ADMIN_ROLES]))
    return stmt.where(
        RoleBinding.role_type == Role.grade_head.value,
        RoleBinding.scope["grade_id"].astext.in_([str(g) for g in grade_ids]),
    )


def _grade_class_ids(db: Session, year_id: UUID, grade_ids: Sequence[UUID]) -> list[UUID]:
    return list(
        db.scalars(
            select(SchoolClass.id).where(
                SchoolClass.academic_year_id == year_id,
                SchoolClass.active.is_(True),
                SchoolClass.grade_id.in_(grade_ids),
            )
        )
    )


def _school_ids(year_id: UUID) -> CompoundSelect:
    return union(_teacher_ids(year_id), _admin_ids(year_id))


def _grade_ids_select(db: Session, year_id: UUID, grade_ids: Sequence[UUID]) -> CompoundSelect:
    classes = _grade_class_ids(db, year_id, grade_ids)
    return union(_teacher_ids(year_id, classes), _admin_ids(year_id, grade_ids))


def _active_users(sender: User, ids: Select | CompoundSelect) -> Select:
    return select(User).where(
        User.school_id == sender.school_id,
        User.status == "active",
        User.id != sender.id,
        User.id.in_(ids),
    )


def _selectable(
    db: Session, sender: User, bindings: Sequence[Binding], year: AcademicYear
) -> Select:
    """发送人能点名选的人(people 与 users 目标共用):学校作用域 = 当前学年有教师绑定或在任管理岗的人;
    年级组长 = 本年级在读班有教师绑定的人 + 本年级组长。只含 active,不含自己。"""
    if _school_wide(bindings, year.school_id):
        return _active_users(sender, _school_ids(year.id))
    grades = sorted(_send_grades(bindings), key=str)
    return _active_users(sender, _grade_ids_select(db, year.id, grades))


def _deny_send(db: Session, request: Request | None, sender: User, object_id: str, kind: str):
    deny(
        db,
        user_id=sender.id,
        action=Perm.NOTICE_SEND.value,
        object_type=kind,
        object_id=object_id,
        request=request,
    )


def resolve_recipients(
    db: Session,
    sender: User,
    bindings: Sequence[Binding],
    target: SchoolTarget | GradeTarget | ClassTarget | UsersTarget,
    year: AcademicYear,
    request: Request | None = None,
) -> tuple[list[UUID], str]:
    """返回 (收件人, target_label);无权限 403,班 / 年级不存在:学校作用域 404,其余 403。"""
    wide = _school_wide(bindings, year.school_id)
    if isinstance(target, SchoolTarget):
        ensure(
            db,
            request,
            sender.id,
            bindings,
            Perm.NOTICE_SEND,
            Scope(school_id=year.school_id),
            object_id=str(year.school_id),
            object_type="school",
        )
        ids, label = _school_ids(year.id), "全校老师"
    elif isinstance(target, GradeTarget):
        grade = db.get(Grade, target.grade_id)
        if grade is None or grade.academic_year_id != year.id or grade.school_id != year.school_id:
            if not wide:
                _deny_send(db, request, sender, str(target.grade_id), "grade")
            raise ApiError(404, "NOT_FOUND", "年级不存在")
        ensure(
            db,
            request,
            sender.id,
            bindings,
            Perm.NOTICE_SEND,
            Scope(school_id=year.school_id, grade_id=grade.id),
            object_id=str(grade.id),
            object_type="grade",
        )
        ids, label = _grade_ids_select(db, year.id, [grade.id]), f"{grade.name}老师"
    elif isinstance(target, ClassTarget):
        cls = db.get(SchoolClass, target.class_id)
        if (
            cls is None
            or not cls.active
            or cls.academic_year_id != year.id
            or cls.school_id != year.school_id
        ):
            if not wide:
                _deny_send(db, request, sender, str(target.class_id), "class")
            raise ApiError(404, "NOT_FOUND", "班级不存在")
        ensure(
            db,
            request,
            sender.id,
            bindings,
            Perm.NOTICE_SEND,
            Scope(school_id=year.school_id, grade_id=cls.grade_id, class_id=cls.id),
            object_id=str(cls.id),
            object_type="class",
        )
        ids, label = _teacher_ids(year.id, [cls.id]), f"{cls.name}老师"
    else:
        picked = set(target.user_ids)
        allowed = set(
            db.scalars(
                _selectable(db, sender, bindings, year)
                .where(User.id.in_(picked))
                .with_only_columns(User.id)
            )
        )
        if allowed != picked:
            _deny_send(db, request, sender, str(year.school_id), "school")
        return list(target.user_ids), f"指定 {len(target.user_ids)} 人"

    users = db.scalars(
        _active_users(sender, ids).with_only_columns(User.id).order_by(User.id)
    ).all()
    return list(users), label


# ---- 发送 / 撤回 ----


def _counts(db: Session, notice_ids: Sequence[UUID]) -> dict[UUID, tuple[int, int]]:
    if not notice_ids:
        return {}
    rows = db.execute(
        select(NoticeRecipient.notice_id, func.count(), func.count(NoticeRecipient.read_at))
        .where(NoticeRecipient.notice_id.in_(notice_ids))
        .group_by(NoticeRecipient.notice_id)
    ).all()
    return {nid: (total, read) for nid, total, read in rows}


def _sent_view(notice: Notice, recipients: int, read: int) -> NoticeSent:
    return NoticeSent(
        id=notice.id,
        title=notice.title,
        content=notice.content,
        target_label=notice.target_label,
        created_at=notice.created_at,
        recalled_at=notice.recalled_at,
        recipients=recipients,
        read=read,
    )


def sent_views(db: Session, notices: Sequence[Notice]) -> list[NoticeSent]:
    counts = _counts(db, [n.id for n in notices])
    return [_sent_view(n, *counts.get(n.id, (0, 0))) for n in notices]


def send(
    db: Session,
    redis: Redis,
    sender: User,
    bindings: Sequence[Binding],
    body: NoticeInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> NoticeSent:
    """收件人在此刻确定并落库;先提交,再发布 notice.new(发布失败不影响已发出的通知)。"""
    year = require_active_year(db, sender.school_id)
    recipients, label = resolve_recipients(db, sender, bindings, body.target, year, request)
    if not recipients:
        raise ApiError(400, "NO_RECIPIENTS", "没有可接收的人")
    notice = Notice(
        school_id=sender.school_id,
        from_user_id=sender.id,
        title=body.title,
        content=body.content,
        target=body.target.model_dump(mode="json"),
        target_label=label,
        require_ack=False,
        created_at=now,
    )
    db.add(notice)
    db.flush()
    db.add_all(NoticeRecipient(notice_id=notice.id, user_id=uid) for uid in recipients)
    record(
        db,
        user_id=sender.id,
        action="notice.send",
        success=True,
        object_type="notice",
        object_id=str(notice.id),
        request=request,
        extra={"target": _audit_target(body), "recipients": len(recipients)},
    )
    db.commit()
    publish(
        redis,
        recipients,
        {
            "type": "notice.new",
            "id": str(notice.id),
            "title": notice.title,
            "from_name": sender.display_name,
            "created_at": notice.created_at.isoformat(),
        },
    )
    return _sent_view(notice, len(recipients), 0)


def _audit_target(body: NoticeInput) -> dict:
    """审计只记目标种类与范围,不记点名的人员名单。"""
    return body.target.model_dump(mode="json", exclude={"user_ids"})


def _own_notice(db: Session, sender: User, notice_id: UUID) -> Notice:
    notice = db.get(Notice, notice_id)
    if notice is None or notice.from_user_id != sender.id:
        raise ApiError(404, "NOT_FOUND", "通知不存在")
    return notice


def sent_list(db: Session, sender: User, page: int) -> NoticeSentPage:
    where = Notice.from_user_id == sender.id
    total = db.scalar(select(func.count()).select_from(Notice).where(where)) or 0
    notices = db.scalars(
        select(Notice)
        .where(where)
        .order_by(Notice.created_at.desc(), Notice.id)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    return NoticeSentPage(items=sent_views(db, notices), total=total)


def recent_sent(db: Session, sender: User, limit: int) -> list[NoticeSent]:
    """自己最近发的未撤回通知(今日关注用)。"""
    notices = db.scalars(
        select(Notice)
        .where(Notice.from_user_id == sender.id, Notice.recalled_at.is_(None))
        .order_by(Notice.created_at.desc(), Notice.id)
        .limit(limit)
    ).all()
    return sent_views(db, notices)


def recipients_of(db: Session, sender: User, notice_id: UUID) -> NoticeRecipients:
    notice = _own_notice(db, sender, notice_id)
    rows = db.execute(
        select(User.id, User.display_name, NoticeRecipient.read_at)
        .join(NoticeRecipient, NoticeRecipient.user_id == User.id)
        .where(NoticeRecipient.notice_id == notice.id)
        .order_by(NoticeRecipient.read_at, User.display_name, User.id)
    ).all()
    return NoticeRecipients(
        read=[ReadRecipient(user_id=u, name=n, read_at=r) for u, n, r in rows if r is not None],
        unread=sorted(
            (UnreadRecipient(user_id=u, name=n) for u, n, r in rows if r is None),
            key=lambda p: (p.name, str(p.user_id)),
        ),
    )


def recall(
    db: Session,
    redis: Redis,
    sender: User,
    notice_id: UUID,
    *,
    now: datetime,
    request: Request | None = None,
) -> NoticeSent:
    """只能撤回自己发的;已撤回则原样返回(不重复审计、不重复推送)。"""
    notice = _own_notice(db, sender, notice_id)
    recipients = list(
        db.scalars(select(NoticeRecipient.user_id).where(NoticeRecipient.notice_id == notice.id))
    )
    if notice.recalled_at is None:
        notice.recalled_at = now
        record(
            db,
            user_id=sender.id,
            action="notice.recall",
            success=True,
            object_type="notice",
            object_id=str(notice.id),
            request=request,
        )
        db.commit()
        publish(redis, recipients, {"type": "notice.recalled", "id": str(notice.id)})
    counts = _counts(db, [notice.id])
    return _sent_view(notice, *counts.get(notice.id, (0, 0)))


# ---- 候选人 ----


def _escape_like(raw: str) -> str:
    return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _tags(db: Session, user_ids: Sequence[UUID], year_id: UUID) -> dict[UUID, list[str]]:
    """简短身份;教师岗位只认当前学年,管理岗学年为空或当前学年。"""
    if not user_ids:
        return {}
    rows = db.scalars(
        select(RoleBinding)
        .where(
            RoleBinding.user_id.in_(user_ids),
            RoleBinding.ended_at.is_(None),
            (
                RoleBinding.role_type.in_([r.value for r in TEACHER_ROLES])
                & (RoleBinding.academic_year_id == year_id)
            )
            | (
                RoleBinding.role_type.in_([r.value for r in ADMIN_ROLES])
                & (
                    RoleBinding.academic_year_id.is_(None)
                    | (RoleBinding.academic_year_id == year_id)
                )
            ),
        )
        .order_by(RoleBinding.started_at, RoleBinding.id)
    ).all()
    class_ids = {UUID(b.scope["class_id"]) for b in rows if b.scope.get("class_id")}
    grade_ids = {UUID(b.scope["grade_id"]) for b in rows if b.scope.get("grade_id")}
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
    out: dict[UUID, list[str]] = defaultdict(list)
    for b in rows:
        scope = b.scope or {}
        class_name = classes.get(UUID(scope["class_id"])) if scope.get("class_id") else None
        grade_name = grades.get(UUID(scope["grade_id"])) if scope.get("grade_id") else None
        if b.role_type in _ADMIN_LABELS:
            label = _ADMIN_LABELS[b.role_type]
        elif b.role_type == Role.grade_head.value:
            label = f"{grade_name}组长" if grade_name else None
        elif b.role_type == Role.homeroom_teacher.value:
            label = f"{class_name}班主任" if class_name else None
        elif b.role_type == Role.assistant_teacher.value:
            label = f"{class_name}副班主任" if class_name else None
        else:
            label = scope.get("subject") or "任课老师"
        if label and label not in out[b.user_id]:
            out[b.user_id].append(label)
    return out


def people(
    db: Session, sender: User, bindings: Sequence[Binding], q: str = ""
) -> list[NoticePerson]:
    year = require_active_year(db, sender.school_id)
    stmt = _selectable(db, sender, bindings, year)
    if q.strip():
        like = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            User.display_name.ilike(like, escape="\\") | User.login_name.ilike(like, escape="\\")
        )
    users = db.scalars(stmt.order_by(User.display_name, User.login_name).limit(PEOPLE_LIMIT)).all()
    tags = _tags(db, [u.id for u in users], year.id)
    return [NoticePerson(user_id=u.id, name=u.display_name, tags=tags.get(u.id, [])) for u in users]


# ---- 收件箱 ----


def inbox(db: Session, user: User, page: int) -> Inbox:
    mine = NoticeRecipient.user_id == user.id
    total = db.scalar(select(func.count()).select_from(NoticeRecipient).where(mine)) or 0
    unread = (
        db.scalar(
            select(func.count())
            .select_from(NoticeRecipient)
            .join(Notice, Notice.id == NoticeRecipient.notice_id)
            .where(mine, NoticeRecipient.read_at.is_(None), Notice.recalled_at.is_(None))
        )
        or 0
    )
    rows = db.execute(
        select(Notice, User.display_name, NoticeRecipient.read_at)
        .join(NoticeRecipient, NoticeRecipient.notice_id == Notice.id)
        .outerjoin(User, User.id == Notice.from_user_id)
        .where(mine)
        .order_by(Notice.created_at.desc(), Notice.id)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    items = [
        InboxItem(
            id=n.id,
            title=n.title,
            content=None if n.recalled_at is not None else n.content,
            from_name=from_name,
            created_at=n.created_at,
            read_at=read_at,
            recalled=n.recalled_at is not None,
        )
        for n, from_name, read_at in rows
    ]
    return Inbox(items=items, total=total, unread=unread)


def mark_read(db: Session, user: User, notice_id: UUID, *, now: datetime) -> None:
    """不是自己的通知 404;已读的不改 read_at。"""
    mine = db.scalar(
        select(NoticeRecipient.notice_id).where(
            NoticeRecipient.notice_id == notice_id, NoticeRecipient.user_id == user.id
        )
    )
    if mine is None:
        raise ApiError(404, "NOT_FOUND", "通知不存在")
    db.execute(
        update(NoticeRecipient)
        .where(
            NoticeRecipient.notice_id == notice_id,
            NoticeRecipient.user_id == user.id,
            NoticeRecipient.read_at.is_(None),
        )
        .values(read_at=now)
    )
    db.commit()


def mark_all_read(db: Session, user: User, *, now: datetime) -> None:
    db.execute(
        update(NoticeRecipient)
        .where(NoticeRecipient.user_id == user.id, NoticeRecipient.read_at.is_(None))
        .values(read_at=now)
    )
    db.commit()
