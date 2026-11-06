"""摄像头观看判权(冻结契约"判权"规则 1–7)。

规则 1(开关关 → 404)由调用方在入口处用 `ensure_monitor_on` 执行;
规则 2(家长语境)靠 `rbac.deps.get_bindings` 默认不加载家长绑定:只有家长身份的账号
没有教职工绑定、也没有管理端权限,会一路落到规则 7。这里绝不使用 include_parents=True。
"""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from redis import Redis
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.domain.cameras.schemas import (
    CameraBrief,
    CameraWall,
    ClassCameras,
    PeriodInfo,
    ViewReason,
    WallClass,
    WallGrade,
)
from app.domain.school_settings.service import get_switches
from app.domain.schools.service import active_academic_year
from app.domain.timetable.service import current_slot, teaches_now
from app.errors import ApiError
from app.models import Grade, School, SchoolClass, User
from app.models.cameras import Camera
from app.rbac.bindings import Binding, Scope, can, covers
from app.rbac.roles import ROLE_PERMS, Perm

STATE_KEY = "ws:cam:state:{}"
_STATUSES = ("idle", "streaming", "error")


def ensure_monitor_on(db: Session, school_id: UUID) -> None:
    """规则 1:学校开关"监控"关闭 = 功能不存在。"""
    if not get_switches(db, school_id).monitor:
        raise ApiError(404, "NOT_FOUND", "功能未开启")


def _can_manage(bindings: Sequence[Binding], school_id: UUID) -> bool:
    return can(bindings, Perm.CAMERA_MANAGE, Scope(school_id=school_id))


def _can_see_scope(bindings: Sequence[Binding], target: Scope) -> bool:
    """规则 3/4 的作用域部分:camera.manage 或 camera.view 的绑定覆盖目标。

    校长 / 教导主任 / 信息中心绑学校;年级组长绑年级,只覆盖本年级的班(公共区域只带 school_id,
    covers 对年级绑定不成立)。"""
    return any(
        (Perm.CAMERA_MANAGE in ROLE_PERMS[bd.role] or Perm.CAMERA_VIEW in ROLE_PERMS[bd.role])
        and covers(bd.scope, target)
        for bd in bindings
    )


def class_scope(cls: SchoolClass) -> Scope:
    return Scope(school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id)


def admin_sees_class(bindings: Sequence[Binding], cls: SchoolClass) -> bool:
    return _can_see_scope(bindings, class_scope(cls))


def _teacher_id(db: Session, user_id: UUID) -> UUID | None:
    return db.scalar(text("SELECT id FROM teachers WHERE user_id = :u"), {"u": user_id})


def _active_identities(db: Session, teacher_id: UUID, class_id: UUID, year_id: UUID) -> set[str]:
    """该老师在该班当前学年在任的 homeroom / subject 任职(副班主任不算)。"""
    rows = db.scalars(
        text(
            "SELECT identity FROM teacher_assignments WHERE teacher_id = :t AND class_id = :c"
            " AND academic_year_id = :y AND ended_at IS NULL"
            " AND identity IN ('homeroom', 'subject')"
        ),
        {"t": teacher_id, "c": class_id, "y": year_id},
    ).all()
    return set(rows)


def _period_now(
    db: Session, teacher_id: UUID, cls: SchoolClass, year_id: UUID, now: datetime
) -> PeriodInfo | None:
    cell = teaches_now(db, teacher_id, cls.id, year_id, now)
    if cell is None:
        return None
    slot = current_slot(db, cls.school_id, now)
    if slot is None:  # teaches_now 非空时必有 slot;防御
        return None
    return PeriodInfo(no=cell.period_no, subject=cell.subject, ends_at=slot[2].strftime("%H:%M"))


def class_reason(
    db: Session, user: User, bindings: Sequence[Binding], cls: SchoolClass, now: datetime
) -> tuple[ViewReason, PeriodInfo | None] | None:
    """调用者凭什么能看这个班的摄像头(与单个摄像头是否启用无关);不能 → None。"""
    if cls.school_id != user.school_id:
        return None
    if _can_see_scope(bindings, class_scope(cls)):  # 规则 3 / 4
        return "admin", None
    year = active_academic_year(db, cls.school_id)
    if year is None or cls.academic_year_id != year.id:
        return None
    teacher_id = _teacher_id(db, user.id)
    if teacher_id is None:
        return None
    identities = _active_identities(db, teacher_id, cls.id, year.id)
    if "homeroom" in identities:  # 规则 5
        return "homeroom", None
    if identities:  # 规则 6
        period = _period_now(db, teacher_id, cls, year.id, now)
        if period is not None:
            return "period", period
    return None  # 规则 7(含副班主任、任职已结束)


def can_view(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    camera: Camera,
    now: datetime,
) -> ViewReason | None:
    if camera.school_id != user.school_id:
        return None
    if _can_manage(bindings, camera.school_id):  # 规则 3:含公共区域、含已停用
        return "admin"
    if not camera.enabled:  # 停用的摄像头只有 camera.manage 能碰
        return None
    if camera.class_id is None:  # 公共区域:只有 school 级 camera.view(校长 / 教导主任)
        return "admin" if _can_see_scope(bindings, Scope(school_id=camera.school_id)) else None
    cls = db.get(SchoolClass, camera.class_id)
    if cls is None:
        return None
    found = class_reason(db, user, bindings, cls, now)
    return None if found is None else found[0]


def _state(redis: Redis | None, camera_id: UUID) -> str:
    if redis is None:
        return "idle"
    status = redis.hget(STATE_KEY.format(camera_id), "status")
    return status if status in _STATUSES else "idle"


def _brief(camera: Camera, redis: Redis | None) -> CameraBrief:
    return CameraBrief(
        id=camera.id,
        name=camera.name,
        location=camera.location,  # type: ignore[arg-type]
        status=_state(redis, camera.id),  # type: ignore[arg-type]
    )


def class_cameras(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    now: datetime,
    *,
    redis: Redis | None = None,
) -> ClassCameras:
    """本班可看的(启用的)摄像头。

    不能看 → `cameras=[]`,reason 占位取 'homeroom'(前端按空列表隐藏入口)。"""
    found = class_reason(db, user, bindings, cls, now)
    if found is None:
        return ClassCameras(class_id=cls.id, cameras=[], reason="homeroom", period=None)
    reason, period = found
    rows = db.scalars(
        select(Camera)
        .where(Camera.class_id == cls.id, Camera.enabled.is_(True))
        .order_by(Camera.name, Camera.id)
    ).all()
    return ClassCameras(
        class_id=cls.id,
        cameras=[_brief(c, redis) for c in rows],
        reason=reason,
        period=period if reason == "period" else None,
    )


def enabled_camera_counts(db: Session, class_ids: Sequence[UUID]) -> dict[UUID, int]:
    if not class_ids:
        return {}
    rows = db.execute(
        text(
            "SELECT class_id, count(*) FROM cameras WHERE enabled AND class_id = ANY(:ids)"
            " GROUP BY class_id"
        ),
        {"ids": list(class_ids)},
    ).all()
    return {r[0]: r[1] for r in rows}


def camera_wall(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    *,
    redis: Redis | None = None,
) -> CameraWall:
    """管理端九宫格:只含启用的摄像头;调用者作用域外的班不出现。

    只列出有启用摄像头的班(和年级);当前学年在读班;年级按 display_order、班按名称。"""
    school = db.get(School, user.school_id)
    assert school is not None
    year = active_academic_year(db, user.school_id)
    grades: list[WallGrade] = []
    if year is not None:
        rows = db.execute(
            select(Camera, SchoolClass, Grade)
            .join(SchoolClass, SchoolClass.id == Camera.class_id)
            .join(Grade, Grade.id == SchoolClass.grade_id)
            .where(
                Camera.school_id == user.school_id,
                Camera.enabled.is_(True),
                SchoolClass.academic_year_id == year.id,
                SchoolClass.active.is_(True),
            )
            .order_by(Grade.display_order, Grade.name, SchoolClass.name, Camera.name, Camera.id)
        ).all()
        by_grade: dict[UUID, WallGrade] = {}
        by_class: dict[UUID, WallClass] = {}
        for cam, cls, grade in rows:
            if not _can_see_scope(bindings, class_scope(cls)):
                continue
            wg = by_grade.get(grade.id)
            if wg is None:
                wg = by_grade[grade.id] = WallGrade(
                    grade_id=grade.id, grade_name=grade.name, classes=[]
                )
                grades.append(wg)
            wc = by_class.get(cls.id)
            if wc is None:
                wc = by_class[cls.id] = WallClass(class_id=cls.id, class_name=cls.name, cameras=[])
                wg.classes.append(wc)
            wc.cameras.append(_brief(cam, redis))
    public: list[CameraBrief] = []
    if _can_see_scope(bindings, Scope(school_id=user.school_id)):
        pub_rows = db.scalars(
            select(Camera)
            .where(
                Camera.school_id == user.school_id,
                Camera.enabled.is_(True),
                Camera.class_id.is_(None),
            )
            .order_by(Camera.name, Camera.id)
        ).all()
        public = [_brief(c, redis) for c in pub_rows]
    return CameraWall(
        school_name=school.name,
        timezone=school.timezone,
        grades=grades,
        public=public,
    )
