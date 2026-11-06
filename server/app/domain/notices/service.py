from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from fastapi import Request
from redis import Redis
from sqlalchemy import CompoundSelect, Select, exists, func, select, union, update
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny, record
from app.domain.classes.service import get_class_or_404
from app.domain.notices.schemas import (
    AckBlockReason,
    AckSpec,
    ChoiceAck,
    ClassNoticeInput,
    ClassTarget,
    ConfirmAck,
    GradeTarget,
    Inbox,
    InboxItem,
    MyAck,
    NoAck,
    NoticeInput,
    NoticeOptions,
    NoticePerson,
    NoticeRecipients,
    NoticeSent,
    NoticeSentPage,
    OptionClass,
    OptionGrade,
    ReadRecipient,
    SchoolTarget,
    StudentDetail,
    UnreadRecipient,
    UsersTarget,
)
from app.domain.schools.service import active_academic_year, require_active_year
from app.errors import ApiError
from app.models import (
    AcademicYear,
    Enrollment,
    Grade,
    Notice,
    NoticeRecipient,
    NoticeStudent,
    Parent,
    ParentLink,
    RoleBinding,
    SchoolClass,
    Student,
    User,
)
from app.rbac.bindings import Binding, Scope, can, load_bindings
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


def _authorize_scope(
    db: Session,
    sender: User,
    bindings: Sequence[Binding],
    target: SchoolTarget | GradeTarget | ClassTarget,
    year: AcademicYear,
    request: Request | None,
) -> Grade | SchoolClass | None:
    """school / grade / class 目标的存在性与作用域判定(老师对象与家长对象共用);
    无权限 403,班 / 年级不存在:学校作用域 404,其余 403。返回年级或班(学校目标返回 None)。"""
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
        return None
    if isinstance(target, GradeTarget):
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
        return grade
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
    return cls


def _unavailable_ids(
    db: Session,
    sender: User,
    bindings: Sequence[Binding],
    picked: set[UUID],
    year: AcademicYear,
) -> set[UUID]:
    """L46:只返回"发送人不越权也能确认原本可选"的账号,其余一律交给调用方按越权处理。
    学校作用域:本校账号,曾有过教师 / 管理岗绑定(任何学年、含已结束),现已非 active 或无当前绑定;
    从未有过教师 / 管理岗绑定的账号(纯家长等)不算,避免借 409 探出谁是家长。
    年级组长:仅本年级当前学年仍有绑定(在读班教师绑定或本年级组长岗)但账号已冻结的人。"""
    if not picked:
        return set()
    if not _school_wide(bindings, year.school_id):
        grades = sorted(_send_grades(bindings), key=str)
        return set(
            db.scalars(
                select(User.id).where(
                    User.id.in_(picked),
                    User.school_id == sender.school_id,
                    User.status != "active",
                    User.id.in_(_grade_ids_select(db, year.id, grades)),
                )
            )
        )
    ever_staff = exists().where(
        RoleBinding.user_id == User.id,
        RoleBinding.role_type.in_([r.value for r in (TEACHER_ROLES | ADMIN_ROLES)]),
    )
    return set(
        db.scalars(
            select(User.id).where(
                User.id.in_(picked),
                User.school_id == sender.school_id,
                ever_staff,
                (User.status != "active") | User.id.not_in(_school_ids(year.id)),
            )
        )
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
    if isinstance(target, UsersTarget):
        picked = set(target.user_ids)
        allowed = set(
            db.scalars(
                _selectable(db, sender, bindings, year)
                .where(User.id.in_(picked))
                .with_only_columns(User.id)
            )
        )
        missing = picked - allowed
        if missing:
            gone = _unavailable_ids(db, sender, bindings, missing, year)
            if gone == missing:
                raise ApiError(
                    409,
                    "RECIPIENT_UNAVAILABLE",
                    f"有 {len(gone)} 位已不能接收通知,请去掉后重发",
                    {"user_ids": sorted(str(u) for u in gone)},
                )
            _deny_send(db, request, sender, str(year.school_id), "school")
        return list(target.user_ids), f"指定 {len(target.user_ids)} 人"

    scope = _authorize_scope(db, sender, bindings, target, year, request)
    if isinstance(target, SchoolTarget):
        ids, label = _school_ids(year.id), "全校老师"
    elif isinstance(target, GradeTarget):
        ids, label = _grade_ids_select(db, year.id, [scope.id]), f"{scope.name}老师"
    else:
        ids, label = _teacher_ids(year.id, [scope.id]), f"{scope.name}老师"
    users = db.scalars(
        _active_users(sender, ids).with_only_columns(User.id).order_by(User.id)
    ).all()
    return list(users), label


# (student_id, parent_user_id, class_id, class_name):班是发送时刻的在读班,写进 notice_students
# 做快照(L87)
ParentPair = tuple[UUID, UUID, UUID, str]


def resolve_parent_recipients(
    db: Session,
    sender: User,
    bindings: Sequence[Binding],
    target: SchoolTarget | GradeTarget | ClassTarget | UsersTarget,
    year: AcademicYear,
    request: Request | None = None,
) -> tuple[list[UUID], list[ParentPair], int, str]:
    """家长对象:返回 (收件人, [(student_id, parent_user_id, class_id, class_name)],
    students_without_parent, label)。

    范围内的学生 = 当前学年在读班里 status='active' 的注册;每个学生取主家长
    (is_primary、status='active'、notify_enabled、账号 active 且同校)。
    全部用显式 SQL 判定,不经过 load_bindings / effective_status(家长绑定的作用域是学生,
    混进教师判权会越权)。发送人自己是主家长的学生跳过,不计入 students_without_parent。"""
    if isinstance(target, UsersTarget):
        raise ApiError(400, "TARGET_INVALID", "家长对象只能选全校、年级或班级")
    scope = _authorize_scope(db, sender, bindings, target, year, request)
    return _parent_recipients_in_scope(db, sender, target, scope, year)


def _parent_recipients_in_scope(
    db: Session,
    sender: User,
    target: SchoolTarget | GradeTarget | ClassTarget,
    scope: Grade | SchoolClass | None,
    year: AcademicYear,
) -> tuple[list[UUID], list[ParentPair], int, str]:
    """范围已判过权;按范围取在读学生的主家长(resolve_parent_recipients 与班级公告共用)。"""
    in_scope = (
        select(Enrollment.student_id, SchoolClass.id, SchoolClass.name)
        .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Enrollment.status == "active",
            Enrollment.academic_year_id == year.id,
            SchoolClass.academic_year_id == year.id,
            SchoolClass.school_id == year.school_id,
            SchoolClass.active.is_(True),
            Student.school_id == year.school_id,
        )
    )
    if isinstance(target, GradeTarget):
        in_scope = in_scope.where(SchoolClass.grade_id == scope.id)
        label = f"{scope.name}家长"
    elif isinstance(target, ClassTarget):
        in_scope = in_scope.where(SchoolClass.id == scope.id)
        label = f"{scope.name}家长"
    else:
        label = "全校家长"
    # 一个学生在当前学年只有一条在读注册(enrollments_one_active_per_year),所以每人一行
    klass = {sid: (cid, cname) for sid, cid, cname in db.execute(in_scope)}
    student_ids = set(klass)
    if not student_ids:
        return [], [], 0, label
    primary = db.execute(
        select(ParentLink.student_id, Parent.user_id)
        .join(Parent, Parent.id == ParentLink.parent_id)
        .join(User, User.id == Parent.user_id)
        .where(
            ParentLink.student_id.in_(student_ids),
            ParentLink.is_primary.is_(True),
            ParentLink.status == "active",
            ParentLink.notify_enabled.is_(True),
            User.status == "active",
            User.school_id == sender.school_id,
        )
        .order_by(ParentLink.student_id)
    ).all()
    own_children = set(
        db.scalars(
            select(ParentLink.student_id)
            .join(Parent, Parent.id == ParentLink.parent_id)
            .where(
                ParentLink.student_id.in_(student_ids),
                ParentLink.is_primary.is_(True),
                ParentLink.status == "active",
                Parent.user_id == sender.id,
            )
        )
    )
    pairs: list[ParentPair] = [(sid, uid, *klass[sid]) for sid, uid in primary if uid != sender.id]
    covered = {sid for sid, _ in primary} | own_children
    without = len(student_ids - covered)
    recipients = sorted({p[1] for p in pairs}, key=str)
    return recipients, pairs, without, label


def send_options(
    db: Session, sender: User, bindings: Sequence[Binding], year: AcademicYear
) -> NoticeOptions:
    """L44:调用者能发的当前学年年级与在读班;学校作用域 = 全部,年级组长 = 自己的年级。"""
    wide = _school_wide(bindings, year.school_id)
    grade_q = select(Grade).where(
        Grade.academic_year_id == year.id, Grade.school_id == year.school_id
    )
    if not wide:
        grade_q = grade_q.where(Grade.id.in_(_send_grades(bindings)))
    grades = db.scalars(grade_q.order_by(Grade.display_order, Grade.name, Grade.id)).all()
    grade_ids = [g.id for g in grades]
    classes = (
        db.execute(
            select(SchoolClass)
            .join(Grade, Grade.id == SchoolClass.grade_id)
            .where(
                SchoolClass.academic_year_id == year.id,
                SchoolClass.school_id == year.school_id,
                SchoolClass.active.is_(True),
                SchoolClass.grade_id.in_(grade_ids),
            )
            .order_by(Grade.display_order, Grade.name, SchoolClass.name, SchoolClass.id)
        )
        .scalars()
        .all()
        if grade_ids
        else []
    )
    return NoticeOptions(
        school_wide=wide,
        grades=[OptionGrade(id=g.id, name=g.name) for g in grades],
        classes=[OptionClass(id=c.id, name=c.name, grade_id=c.grade_id) for c in classes],
    )


# ---- 发送 / 撤回 ----


def _counts(db: Session, notice_ids: Sequence[UUID]) -> dict[UUID, tuple[int, int, int]]:
    if not notice_ids:
        return {}
    rows = db.execute(
        select(
            NoticeRecipient.notice_id,
            func.count(),
            func.count(NoticeRecipient.read_at),
            func.count(NoticeRecipient.acked_at),
        )
        .where(NoticeRecipient.notice_id.in_(notice_ids))
        .group_by(NoticeRecipient.notice_id)
    ).all()
    return {nid: (total, read, acked) for nid, total, read, acked in rows}


def ack_spec(notice: Notice) -> AckSpec:
    if notice.ack_kind == "confirm":
        return ConfirmAck(kind="confirm")
    if notice.ack_kind == "choice":
        return ChoiceAck(
            kind="choice", options=list(notice.ack_options or []), allow_note=notice.ack_allow_note
        )
    return NoAck(kind="none")


def without_parent_of(notice: Notice) -> int:
    """发送那一刻记下的"没有可通知主家长的学生数"(notices.students_without_parent 列)。"""
    return notice.students_without_parent


def _sent_view(notice: Notice, recipients: int, read: int, acked: int = 0) -> NoticeSent:
    return NoticeSent(
        id=notice.id,
        title=notice.title,
        content=notice.content,
        target_label=notice.target_label,
        created_at=notice.created_at,
        recalled_at=notice.recalled_at,
        recipients=recipients,
        read=read,
        audience=notice.audience,
        ack=ack_spec(notice),
        ack_deadline=notice.ack_deadline,
        acked=acked,
        students_without_parent=without_parent_of(notice),
    )


def sent_views(db: Session, notices: Sequence[Notice]) -> list[NoticeSent]:
    counts = _counts(db, [n.id for n in notices])
    return [_sent_view(n, *counts.get(n.id, (0, 0, 0))) for n in notices]


def _notice_students(notice_id: UUID, pairs: Sequence[ParentPair]) -> list[NoticeStudent]:
    """每个范围内学生一行,连同发送时刻所在的班一起记下(L87 快照,两处写入点共用)。"""
    return [
        NoticeStudent(
            notice_id=notice_id,
            student_id=sid,
            parent_user_id=uid,
            class_id=class_id,
            class_name=class_name,
        )
        for sid, uid, class_id, class_name in pairs
    ]


def _ack_columns(body: NoticeInput, now: datetime) -> dict:
    """回执设置 → notices 列;截止时间须带时区且晚于现在。"""
    ack = body.ack
    deadline = body.ack_deadline
    if deadline is not None:
        if deadline.tzinfo is None or deadline.utcoffset() is None:
            raise ApiError(400, "BAD_REQUEST", "截止时间需要带时区")
        if deadline <= now:
            raise ApiError(400, "BAD_REQUEST", "截止时间必须晚于现在")
    if ack.kind == "none":
        return {"require_ack": False, "ack_kind": "none", "ack_deadline": None}
    cols = {"require_ack": True, "ack_kind": ack.kind, "ack_deadline": deadline}
    if ack.kind == "choice":
        cols |= {"ack_options": list(ack.options), "ack_allow_note": ack.allow_note}
    return cols


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
    pairs: list[ParentPair] = []
    target = body.target.model_dump(mode="json")
    if body.audience == "parents":
        recipients, pairs, without, label = resolve_parent_recipients(
            db, sender, bindings, body.target, year, request
        )
    else:
        without = 0
        recipients, label = resolve_recipients(db, sender, bindings, body.target, year, request)
    ack_cols = _ack_columns(body, now)  # 先判权(上面),再校验回执设置与截止时间
    if not recipients:
        raise ApiError(400, "NO_RECIPIENTS", "没有可接收的人")
    notice = Notice(
        school_id=sender.school_id,
        from_user_id=sender.id,
        title=body.title,
        content=body.content,
        target=target,
        target_label=label,
        students_without_parent=without,
        audience=body.audience,
        created_at=now,
        **ack_cols,
    )
    db.add(notice)
    db.flush()
    db.add_all(NoticeRecipient(notice_id=notice.id, user_id=uid) for uid in recipients)
    db.add_all(_notice_students(notice.id, pairs))
    record(
        db,
        user_id=sender.id,
        action="notice.send",
        success=True,
        object_type="notice",
        object_id=str(notice.id),
        request=request,
        extra={
            "target": _audit_target(body),
            "recipients": len(recipients),
            "audience": body.audience,
            "ack": body.ack.kind,
        },
    )
    # 提交会让 ORM 对象过期;先取好负载与响应,提交后立刻发布,不再触发刷新查询
    event = {
        "type": "notice.new",
        "id": str(notice.id),
        "title": notice.title,
        "from_name": sender.display_name,
        "created_at": notice.created_at.isoformat(),
    }
    view = _sent_view(notice, len(recipients), 0)
    db.commit()
    publish(redis, recipients, event)
    return view


def _class_for_notice(
    db: Session,
    request: Request | None,
    user: User,
    bindings: Sequence[Binding],
    class_id: UUID,
) -> SchoolClass:
    """班级公告的判权:本校的班 + 该班作用域内的 class.notice(家长绑定不在 bindings 里,一律 403)。
    停用的班 / 非当前学年的班对有权限的人 404。"""
    cls = get_class_or_404(db, class_id)
    if cls.school_id != user.school_id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.CLASS_NOTICE,
        Scope(school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id),
        object_id=str(cls.id),
    )
    year = require_active_year(db, user.school_id)
    if not cls.active or cls.academic_year_id != year.id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    return cls


def send_class_notice(
    db: Session,
    redis: Redis,
    sender: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    body: ClassNoticeInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> NoticeSent:
    """班主任给本班家长发公告:对象固定为本班家长,收件人在此刻确定并落库后再推 notice.new。"""
    cls = _class_for_notice(db, request, sender, bindings, class_id)
    year = require_active_year(db, sender.school_id)
    full = NoticeInput(
        title=body.title,
        content=body.content,
        target=ClassTarget(kind="class", class_id=cls.id),
        audience="parents",
        ack=body.ack,
        ack_deadline=body.ack_deadline,
    )
    ack_cols = _ack_columns(full, now)
    recipients, pairs, without, label = _parent_recipients_in_scope(
        db, sender, full.target, cls, year
    )
    if not recipients:
        raise ApiError(400, "NO_RECIPIENTS", "没有可接收的人")
    target = full.target.model_dump(mode="json")
    notice = Notice(
        school_id=sender.school_id,
        from_user_id=sender.id,
        class_id=cls.id,
        title=body.title,
        content=body.content,
        target=target,
        target_label=label,
        students_without_parent=without,
        audience="parents",
        created_at=now,
        **ack_cols,
    )
    db.add(notice)
    db.flush()
    db.add_all(NoticeRecipient(notice_id=notice.id, user_id=uid) for uid in recipients)
    db.add_all(_notice_students(notice.id, pairs))
    record(
        db,
        user_id=sender.id,
        action="notice.send",
        success=True,
        object_type="notice",
        object_id=str(notice.id),
        request=request,
        extra={
            "target": _audit_target(full),
            "recipients": len(recipients),
            "audience": "parents",
            "ack": body.ack.kind,
        },
    )
    event = {
        "type": "notice.new",
        "id": str(notice.id),
        "title": notice.title,
        "from_name": sender.display_name,
        "created_at": notice.created_at.isoformat(),
    }
    view = _sent_view(notice, len(recipients), 0)
    db.commit()
    publish(redis, recipients, event)
    return view


def class_sent_list(
    db: Session,
    request: Request | None,
    sender: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    page: int,
) -> NoticeSentPage:
    """自己发给这个班家长的公告,时间倒序。"""
    cls = _class_for_notice(db, request, sender, bindings, class_id)
    where = (Notice.from_user_id == sender.id, Notice.class_id == cls.id)
    total = db.scalar(select(func.count()).select_from(Notice).where(*where)) or 0
    notices = db.scalars(
        select(Notice)
        .where(*where)
        .order_by(Notice.created_at.desc(), Notice.id)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    return NoticeSentPage(items=sent_views(db, notices), total=total)


def recall_class_notice(
    db: Session,
    redis: Redis,
    sender: User,
    bindings: Sequence[Binding],
    class_id: UUID,
    notice_id: UUID,
    *,
    now: datetime,
    request: Request | None = None,
) -> NoticeSent:
    """只能撤回自己发给这个班的公告,否则 404;撤回与推送复用 recall。"""
    cls = _class_for_notice(db, request, sender, bindings, class_id)
    notice = _own_notice(db, sender, notice_id)
    if notice.class_id != cls.id:
        raise ApiError(404, "NOT_FOUND", "通知不存在")
    return recall(db, redis, sender, notice_id, now=now, request=request)


def _audit_target(body: NoticeInput) -> dict:
    """审计只记目标种类与范围,不记点名的人员名单。"""
    return body.target.model_dump(mode="json", exclude={"user_ids"})


def _still_entitled(db: Session, sender: User, notice: Notice) -> bool:
    """发送人现在仍有权限发这条通知(L86):班级公告 = 仍持有该班的 class.notice(班主任);
    管理端通知 = 持有 notice.send 且作用域仍覆盖原对象(学校 / 年级 / 班;点名只要仍有发件权)。"""
    year = active_academic_year(db, sender.school_id)
    bindings = load_bindings(db, sender.id, year.id if year else None)
    school_id = notice.school_id
    if notice.class_id is not None:
        cls = db.get(SchoolClass, notice.class_id)
        if cls is None:
            return False
        scope = Scope(school_id=school_id, grade_id=cls.grade_id, class_id=cls.id)
        return can(bindings, Perm.CLASS_NOTICE, scope)
    kind = notice.target.get("kind")
    if kind == "school":
        return can(bindings, Perm.NOTICE_SEND, Scope(school_id=school_id))
    if kind == "grade":
        grade_id = UUID(notice.target["grade_id"])
        return can(bindings, Perm.NOTICE_SEND, Scope(school_id=school_id, grade_id=grade_id))
    if kind == "class":
        cls = db.get(SchoolClass, UUID(notice.target["class_id"]))
        if cls is None:
            return False
        scope = Scope(school_id=school_id, grade_id=cls.grade_id, class_id=cls.id)
        return can(bindings, Perm.NOTICE_SEND, scope)
    return _holds_send(bindings)


def _own_notice(db: Session, sender: User, notice_id: UUID) -> Notice:
    notice = db.get(Notice, notice_id)
    if (
        notice is None
        or notice.from_user_id != sender.id
        or not _still_entitled(db, sender, notice)
    ):
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
    # 原子地抢占撤回:并发的两次撤回只有一次影响到行,审计与推送只发生一次
    won = db.execute(
        update(Notice)
        .where(Notice.id == notice.id, Notice.recalled_at.is_(None))
        .values(recalled_at=now)
    ).rowcount
    if won:
        record(
            db,
            user_id=sender.id,
            action="notice.recall",
            success=True,
            object_type="notice",
            object_id=str(notice.id),
            request=request,
        )
    db.refresh(notice)
    counts = _counts(db, [notice.id])
    view = _sent_view(notice, *counts.get(notice.id, (0, 0, 0)))
    nid = str(notice.id)
    if won:
        db.commit()
        publish(redis, recipients, {"type": "notice.recalled", "id": nid})
    return view


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


def inbox(db: Session, user: User, page: int, *, now: datetime | None = None) -> Inbox:
    """只返回以我为收件人的通知(notice_recipients.user_id = 我)。"""
    now = now or clock.utc_now()
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
        select(
            Notice,
            User.display_name,
            NoticeRecipient.read_at,
            NoticeRecipient.acked_at,
            NoticeRecipient.ack_choice,
            NoticeRecipient.ack_content,
        )
        .join(NoticeRecipient, NoticeRecipient.notice_id == Notice.id)
        .outerjoin(User, User.id == Notice.from_user_id)
        .where(mine)
        .order_by(Notice.created_at.desc(), Notice.id)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    parent_ids = [r[0].id for r in rows if r[0].audience == "parents"]
    kids: dict[UUID, list[StudentDetail]] = defaultdict(list)
    primary_live: set[UUID] = set()  # 至少一个孩子:我的绑定在用且是主家长
    secondary_live: set[UUID] = set()  # 至少一个孩子:我的绑定在用但不是主家长
    if parent_ids:
        # 一次查询取当页所有通知涉及的孩子姓名(按学号)、发送时的班与我和孩子的绑定状态;
        # parent_links (parent_id, student_id) 唯一,外连接不会把一个孩子变成多行
        my_link = (ParentLink.student_id == NoticeStudent.student_id) & ParentLink.parent_id.in_(
            select(Parent.id).where(Parent.user_id == user.id)
        )
        for nid, name, class_name, status, is_primary in db.execute(
            select(
                NoticeStudent.notice_id,
                Student.name,
                NoticeStudent.class_name,
                ParentLink.status,
                ParentLink.is_primary,
            )
            .join(Student, Student.id == NoticeStudent.student_id)
            .outerjoin(ParentLink, my_link)
            .where(NoticeStudent.notice_id.in_(parent_ids), NoticeStudent.parent_user_id == user.id)
            .order_by(Student.student_no.nulls_last(), Student.mk)
        ):
            kids[nid].append(StudentDetail(name=name, class_name=class_name))
            if status == "active":
                (primary_live if is_primary else secondary_live).add(nid)
    items = []
    for n, from_name, read_at, acked_at, choice, content in rows:
        recalled = n.recalled_at is not None
        reason = _ack_block_reason(n, now, primary_live, secondary_live)
        items.append(
            InboxItem(
                id=n.id,
                title=n.title,
                content=None if recalled else n.content,
                from_name=from_name,
                created_at=n.created_at,
                read_at=read_at,
                recalled=recalled,
                ack=ack_spec(n),
                ack_deadline=n.ack_deadline,
                my_ack=(
                    MyAck(choice=choice, note=content, acked_at=acked_at)
                    if acked_at is not None
                    else None
                ),
                students=[k.name for k in kids.get(n.id, [])],
                students_detail=kids.get(n.id, []),
                can_ack=n.ack_kind != "none" and reason is None,
                ack_block_reason=reason,
            )
        )
    return Inbox(items=items, total=total, unread=unread)


def _ack_block_reason(
    n: Notice, now: datetime, primary_live: set[UUID], secondary_live: set[UUID]
) -> AckBlockReason | None:
    """不能回执的原因(L88),按优先级:撤回 > 已过截止(服务器时间)> 家长绑定。
    家长对象:有一个孩子仍是在用的主家长绑定就能回执;否则有在用绑定但都不是主家长 → not_primary,
    一个在用的都没有(只读 / 已结束)→ readonly。不需要回执的通知没有"原因"。"""
    if n.ack_kind == "none":
        return None
    if n.recalled_at is not None:
        return "recalled"
    if n.ack_deadline is not None and now >= n.ack_deadline:
        return "closed"
    if n.audience != "parents" or n.id in primary_live:
        return None
    return "not_primary" if n.id in secondary_live else "readonly"


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
