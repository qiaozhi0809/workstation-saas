from datetime import datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.org import service
from app.domain.org.schemas import AdminRole, AdminRoleInput, ClassAdmin, StaffInput
from app.domain.org.service import class_admin
from app.errors import ApiError
from app.models import Grade, RoleBinding, SchoolClass, User
from app.rbac.admin import account_admin_count
from app.rbac.roles import Role

_BINDING_ROLE = {
    "homeroom": Role.homeroom_teacher.value,
    "assistant": Role.assistant_teacher.value,
    "subject": Role.subject_teacher.value,
}
ADMIN_ROLE_ORDER = (Role.principal, Role.dean, Role.grade_head, Role.it_admin)
ACCOUNT_ROLES = frozenset({Role.principal.value, Role.it_admin.value})
_HOMEROOM_INDEX = "teacher_assignments_one_homeroom"


def _bad_user() -> ApiError:
    return ApiError(400, "BAD_REQUEST", "请选择本校在用的教师账号", {"field": "user_id"})


def _active_teacher_id(db: Session, school_id: UUID, user_id: UUID) -> UUID:
    teacher_id = db.execute(
        text(
            "SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id"
            " WHERE u.id = :u AND u.school_id = :s AND u.status = 'active'"
        ),
        {"u": user_id, "s": school_id},
    ).scalar()
    if teacher_id is None:
        raise _bad_user()
    return teacher_id


def _end_bindings(
    db: Session, user_id: UUID, role: str, class_id: UUID, subject: str | None, now: datetime
) -> None:
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = :now"
            " WHERE user_id = :u AND role_type = :r AND ended_at IS NULL"
            " AND scope->>'class_id' = :c AND (scope->>'subject') IS NOT DISTINCT FROM :sub"
        ),
        {"now": now, "u": user_id, "r": role, "c": str(class_id), "sub": subject},
    )


def add_staff(
    db: Session,
    cls: SchoolClass,
    body: StaffInput,
    *,
    now: datetime,
    actor_id: UUID,
    request: Request | None = None,
) -> ClassAdmin:
    service.lock_class(db, cls)
    subject = body.subject or None
    if body.identity == "subject":
        if subject is None or len(subject) > 10:
            raise ApiError(400, "BAD_REQUEST", "任课教师需要填写 1 到 10 个字的科目")
    elif subject is not None:
        raise ApiError(400, "BAD_REQUEST", "只有任课教师需要填写科目")
    teacher_id = _active_teacher_id(db, cls.school_id, body.user_id)
    params = {"t": teacher_id, "c": cls.id, "i": body.identity, "sub": subject}
    duplicate = db.execute(
        text(
            "SELECT 1 FROM teacher_assignments WHERE teacher_id = :t AND class_id = :c"
            " AND identity = :i AND ended_at IS NULL"
            " AND (:i <> 'subject' OR subject = :sub) LIMIT 1"
        ),
        params,
    ).first()
    if duplicate:
        raise ApiError(409, "ALREADY_ASSIGNED", "该教师已在此班担任同一职务")
    try:
        _write_staff(db, cls, body, teacher_id, subject, params, now, actor_id, request)
    except IntegrityError as exc:
        # 班级行锁之外的最后一道防线:同班只能有一位在任班主任(部分唯一索引)
        diag = getattr(exc.orig, "diag", None)
        if getattr(diag, "constraint_name", None) != _HOMEROOM_INDEX:
            raise
        db.rollback()
        raise ApiError(409, "HOMEROOM_TAKEN", "该班已有班主任,请刷新后重试") from exc
    return class_admin(db, cls)


def _write_staff(
    db: Session,
    cls: SchoolClass,
    body: StaffInput,
    teacher_id: UUID,
    subject: str | None,
    params: dict[str, object],
    now: datetime,
    actor_id: UUID,
    request: Request | None,
) -> None:
    if body.identity == "homeroom":
        old = db.execute(
            text(
                "SELECT ta.id, t.user_id FROM teacher_assignments ta"
                " JOIN teachers t ON t.id = ta.teacher_id"
                " WHERE ta.class_id = :c AND ta.identity = 'homeroom' AND ta.ended_at IS NULL"
            ),
            {"c": cls.id},
        ).all()
        for row in old:
            db.execute(
                text("UPDATE teacher_assignments SET ended_at = :now WHERE id = :id"),
                {"now": now, "id": row.id},
            )
            _end_bindings(db, row.user_id, Role.homeroom_teacher.value, cls.id, None, now)
    assignment_id = db.execute(
        text(
            "INSERT INTO teacher_assignments"
            " (teacher_id, class_id, academic_year_id, identity, subject, started_at)"
            " VALUES (:t, :c, :y, :i, :sub, :now) RETURNING id"
        ),
        {**params, "y": cls.academic_year_id, "now": now},
    ).scalar_one()
    scope: dict[str, str] = {"class_id": str(cls.id)}
    if subject is not None:
        scope["subject"] = subject
    db.add(
        RoleBinding(
            user_id=body.user_id,
            role_type=_BINDING_ROLE[body.identity],
            scope=scope,
            academic_year_id=cls.academic_year_id,
            started_at=now,
        )
    )
    if body.identity == "homeroom":
        cls.homeroom_teacher_id = teacher_id
    record(
        db,
        user_id=actor_id,
        action="org.staff_add",
        success=True,
        object_type="teacher_assignment",
        object_id=str(assignment_id),
        request=request,
        extra={
            "class_id": str(cls.id),
            "user_id": str(body.user_id),
            "identity": body.identity,
            "subject": subject,
        },
    )
    db.commit()


def end_staff(
    db: Session,
    school_id: UUID,
    assignment_id: UUID,
    *,
    now: datetime,
    actor_id: UUID,
    request: Request | None = None,
) -> None:
    row = db.execute(
        text(
            "SELECT ta.id, ta.teacher_id, ta.class_id, ta.identity, ta.subject, t.user_id"
            " FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id"
            " JOIN classes c ON c.id = ta.class_id"
            " WHERE ta.id = :id AND ta.ended_at IS NULL AND c.school_id = :s"
        ),
        {"id": assignment_id, "s": school_id},
    ).first()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "任职记录不存在或已结束")
    # 班级行锁(L52):与换班主任(会结束旧任职)、删班、学年升级串行。不锁时两边会互相等对方
    # 已改过的行(任职行 / 班级行)而死锁,或把对方刚结束的任职再"结束"一次并多记一条审计。
    cls = db.get(SchoolClass, row.class_id)
    if cls is None:
        raise ApiError(404, "NOT_FOUND", "任职记录不存在或已结束")
    service.lock_class(db, cls)
    still_open = db.execute(
        text("SELECT 1 FROM teacher_assignments WHERE id = :id AND ended_at IS NULL"),
        {"id": assignment_id},
    ).first()
    if still_open is None:
        raise ApiError(409, "STAFF_CHANGED", "该任职刚被其他操作结束,请刷新后重试")
    db.execute(
        text("UPDATE teacher_assignments SET ended_at = :now WHERE id = :id"),
        {"now": now, "id": assignment_id},
    )
    subject = row.subject if row.identity == "subject" else None
    _end_bindings(db, row.user_id, _BINDING_ROLE[row.identity], row.class_id, subject, now)
    if row.identity == "homeroom":
        db.execute(
            text(
                "UPDATE classes SET homeroom_teacher_id = NULL"
                " WHERE id = :c AND homeroom_teacher_id = :t"
            ),
            {"c": row.class_id, "t": row.teacher_id},
        )
    record(
        db,
        user_id=actor_id,
        action="org.staff_end",
        success=True,
        object_type="teacher_assignment",
        object_id=str(assignment_id),
        request=request,
        extra={"class_id": str(row.class_id), "identity": row.identity},
    )
    db.commit()


def _role_out(bd: RoleBinding, display_name: str, grades: dict[str, Grade]) -> AdminRole:
    grade = grades.get(bd.scope.get("grade_id", ""))
    return AdminRole(
        binding_id=bd.id,
        user_id=bd.user_id,
        display_name=display_name,
        role=bd.role_type,
        grade_id=grade.id if grade else None,
        grade_name=grade.name if grade else None,
    )


def _grades_of(db: Session, school_id: UUID) -> dict[str, Grade]:
    return {str(g.id): g for g in db.scalars(select(Grade).where(Grade.school_id == school_id))}


def list_roles(db: Session, school_id: UUID, year_id: UUID) -> list[AdminRole]:
    rows = db.execute(
        select(RoleBinding, User.display_name)
        .join(User, User.id == RoleBinding.user_id)
        .where(
            User.school_id == school_id,
            RoleBinding.ended_at.is_(None),
            RoleBinding.role_type.in_([r.value for r in ADMIN_ROLE_ORDER]),
            (RoleBinding.academic_year_id.is_(None)) | (RoleBinding.academic_year_id == year_id),
        )
    ).all()
    grades = _grades_of(db, school_id)
    order = [r.value for r in ADMIN_ROLE_ORDER]
    rows.sort(key=lambda r: (order.index(r[0].role_type), r[1], str(r[0].id)))
    return [_role_out(bd, name, grades) for bd, name in rows]


def add_role(
    db: Session,
    school_id: UUID,
    year_id: UUID,
    body: AdminRoleInput,
    *,
    now: datetime,
    actor_id: UUID,
    request: Request | None = None,
) -> AdminRole:
    user = db.get(User, body.user_id)
    if user is None or user.school_id != school_id or user.status != "active":
        raise _bad_user()
    grades = _grades_of(db, school_id)
    if body.role == Role.grade_head.value:
        grade = grades.get(str(body.grade_id)) if body.grade_id else None
        if grade is None or grade.academic_year_id != year_id:
            raise ApiError(
                400, "BAD_REQUEST", "年级组长必须指定当前学年的年级", {"field": "grade_id"}
            )
        scope = {"grade_id": str(grade.id)}
        bind_year: UUID | None = year_id
    else:
        if body.grade_id is not None:
            raise ApiError(400, "BAD_REQUEST", "该岗位不能指定年级", {"field": "grade_id"})
        scope = {"school_id": str(school_id)}
        bind_year = None
    dup = db.scalars(
        select(RoleBinding.id).where(
            RoleBinding.user_id == body.user_id,
            RoleBinding.role_type == body.role,
            RoleBinding.ended_at.is_(None),
            RoleBinding.scope == scope,
        )
    ).first()
    if dup is not None:
        raise ApiError(409, "ALREADY_ASSIGNED", "该账号已担任此岗位")
    bd = RoleBinding(
        user_id=body.user_id,
        role_type=body.role,
        scope=scope,
        academic_year_id=bind_year,
        started_at=now,
    )
    db.add(bd)
    db.flush()
    record(
        db,
        user_id=actor_id,
        action="org.role_add",
        success=True,
        object_type="role_binding",
        object_id=str(bd.id),
        request=request,
        extra={"user_id": str(body.user_id), "role": body.role, "scope": scope},
    )
    db.commit()
    return _role_out(bd, user.display_name, grades)


def get_role_binding(db: Session, school_id: UUID, binding_id: UUID) -> RoleBinding:
    bd = db.scalars(
        select(RoleBinding)
        .join(User, User.id == RoleBinding.user_id)
        .where(
            RoleBinding.id == binding_id,
            RoleBinding.ended_at.is_(None),
            RoleBinding.role_type.in_([r.value for r in ADMIN_ROLE_ORDER]),
            User.school_id == school_id,
        )
    ).first()
    if bd is None:
        raise ApiError(404, "NOT_FOUND", "岗位任命不存在或已结束")
    return bd


def end_role(
    db: Session,
    school_id: UUID,
    bd: RoleBinding,
    *,
    now: datetime,
    actor_id: UUID,
    request: Request | None = None,
) -> None:
    if bd.role_type in ACCOUNT_ROLES:
        # 同校卸任串行,否则两人同时卸任会各自看到对方还在
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k)::bigint)"),
            {"k": f"last-admin:{school_id}"},
        )
        holder = db.get(User, bd.user_id)
        if (
            holder is not None
            and holder.status == "active"
            and account_admin_count(db, school_id, excluding_binding=bd.id) == 0
        ):
            raise ApiError(409, "LAST_ADMIN", "这是最后一位能管理账号的人,不能卸任")
    bd.ended_at = now
    record(
        db,
        user_id=actor_id,
        action="org.role_end",
        success=True,
        object_type="role_binding",
        object_id=str(bd.id),
        request=request,
        extra={"user_id": str(bd.user_id), "role": bd.role_type},
    )
    db.commit()
