"""开学准备清单:管理端"今日关注"顶部的八项自检(M5d Task 10)。

只读。每项回答"做没做"外加一句现状(`detail`),`to` 是对应的管理端页面路径。
依赖当前学年的几项(年级学段、班级、班主任、课表)在没有当前学年时统一写"先设置当前学年",
让管理员先去把学年建好,而不是看到一串"还没有"。
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.orm import Session

from app.ai.settings import is_ready, load_ai_config
from app.domain.school_settings.service import get_switches
from app.domain.schools.service import active_academic_year
from app.models import AcademicYear, Camera, Grade, SchoolClass, TimetableEntry

SetupKey = Literal[
    "school", "year", "classes", "accounts", "assignments", "timetable", "cameras", "ai"
]


class SetupItem(BaseModel):
    key: SetupKey
    done: bool
    detail: str
    to: str


NO_YEAR = "先设置当前学年"
SKIP_MONITOR = "未启用监控,可跳过"
NO_AI = "不配置也能用,只是没有 AI 助手"


def _class_conds(school_id: UUID, year_id: UUID) -> tuple[ColumnElement[bool], ...]:
    """当前学年在用的班(与组织架构页列班的口径一致)。"""
    return (
        SchoolClass.school_id == school_id,
        SchoolClass.academic_year_id == year_id,
        SchoolClass.active.is_(True),
    )


def _school(db: Session, school_id: UUID, year: AcademicYear | None) -> SetupItem:
    """每个年级都显式设了学段(R17):科目目录按学段取,不靠年级名猜。"""
    to = "/admin/org"
    if year is None:
        return SetupItem(key="school", done=False, detail=NO_YEAR, to=to)
    total, unset = db.execute(
        select(func.count(), func.count().filter(Grade.stage.is_(None))).where(
            Grade.school_id == school_id, Grade.academic_year_id == year.id
        )
    ).one()
    if total == 0:
        return SetupItem(key="school", done=False, detail="还没有年级", to=to)
    if unset:
        return SetupItem(key="school", done=False, detail=f"{unset} 个年级未设学段", to=to)
    return SetupItem(key="school", done=True, detail=f"{total} 个年级都已设学段", to=to)


def _year(year: AcademicYear | None) -> SetupItem:
    detail = f"当前学年 {year.name}" if year is not None else "还没有当前学年"
    return SetupItem(key="year", done=year is not None, detail=detail, to="/admin/upgrade")


def _classes(db: Session, school_id: UUID, year: AcademicYear | None) -> SetupItem:
    to = "/admin/org"
    if year is None:
        return SetupItem(key="classes", done=False, detail=NO_YEAR, to=to)
    n = (
        db.scalar(
            select(func.count()).select_from(SchoolClass).where(*_class_conds(school_id, year.id))
        )
        or 0
    )
    detail = f"已建 {n} 个班" if n else "当前学年还没有班级"
    return SetupItem(key="classes", done=n > 0, detail=detail, to=to)


def _accounts(db: Session, school_id: UUID) -> SetupItem:
    """除"纯信息中心"账号外的在用教职工账号:安装时只有一个信息中心管理员,
    之后是否给老师们建了账号就看这一项。只排除在任绑定全是 it_admin 的账号——信息中心
    兼班主任 / 校长的仍算教职工;家长账号没有 teachers 行,不算。"""
    n = db.scalar(
        text(
            "SELECT count(*) FROM users u JOIN teachers t ON t.user_id = u.id"
            " WHERE u.school_id = :s AND u.status = 'active'"
            " AND (NOT EXISTS (SELECT 1 FROM role_bindings rb WHERE rb.user_id = u.id"
            "        AND rb.role_type = 'it_admin' AND rb.ended_at IS NULL)"
            "   OR EXISTS (SELECT 1 FROM role_bindings rb WHERE rb.user_id = u.id"
            "        AND rb.role_type <> 'it_admin' AND rb.ended_at IS NULL))"
        ),
        {"s": school_id},
    )
    detail = f"已有 {n} 个教职工账号" if n else "除管理员外还没有教职工账号"
    return SetupItem(key="accounts", done=bool(n), detail=detail, to="/admin/accounts")


def _assignments(db: Session, school_id: UUID, year: AcademicYear | None) -> SetupItem:
    """每个班都有在任班主任(teacher_assignments 里 identity=homeroom 且未结束)。"""
    to = "/admin/org"
    if year is None:
        return SetupItem(key="assignments", done=False, detail=NO_YEAR, to=to)
    total, staffed = db.execute(
        text(
            "SELECT count(*), count(*) FILTER (WHERE EXISTS ("
            "  SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = c.id"
            "  AND ta.identity = 'homeroom' AND ta.ended_at IS NULL))"
            " FROM classes c"
            " WHERE c.school_id = :s AND c.academic_year_id = :y AND c.active"
        ),
        {"s": school_id, "y": year.id},
    ).one()
    if total == 0:
        return SetupItem(key="assignments", done=False, detail="还没有班级", to=to)
    missing = total - staffed
    if missing:
        detail = f"已建 {total} 个班,{missing} 个班还没有班主任"
        return SetupItem(key="assignments", done=False, detail=detail, to=to)
    return SetupItem(key="assignments", done=True, detail=f"{total} 个班都有班主任", to=to)


def _timetable(db: Session, school_id: UUID, year: AcademicYear | None, monitor: bool) -> SetupItem:
    """至少一个班排了课表;课表只给监控用(教室条 / 看板的"现在在上什么课"),监控关着就可跳过。"""
    to = "/admin/timetable"
    if not monitor:
        return SetupItem(key="timetable", done=True, detail=SKIP_MONITOR, to=to)
    if year is None:
        return SetupItem(key="timetable", done=False, detail=NO_YEAR, to=to)
    n = (
        db.scalar(
            select(func.count(func.distinct(TimetableEntry.class_id))).where(
                TimetableEntry.academic_year_id == year.id,
                TimetableEntry.class_id.in_(
                    select(SchoolClass.id).where(*_class_conds(school_id, year.id))
                ),
            )
        )
        or 0
    )
    detail = f"{n} 个班有课表" if n else "还没有班级排课表"
    return SetupItem(key="timetable", done=n > 0, detail=detail, to=to)


def _cameras(db: Session, school_id: UUID, monitor: bool) -> SetupItem:
    to = "/admin/cameras"
    if not monitor:
        return SetupItem(key="cameras", done=True, detail=SKIP_MONITOR, to=to)
    n = db.scalar(select(func.count()).where(Camera.school_id == school_id)) or 0
    detail = f"已添加 {n} 个摄像头" if n else "还没有添加摄像头"
    return SetupItem(key="cameras", done=n > 0, detail=detail, to=to)


def _ai(db: Session, school_id: UUID, master_key: bytes) -> SetupItem:
    """已配置 = 现在就能调用:地址、模型都有,且有 Key 或是本机服务(同 /ai/status 的口径)。"""
    cfg = load_ai_config(db, school_id, master_key)
    if cfg is not None and is_ready(cfg):
        detail = f"已配置 AI 服务({cfg.model})"
        return SetupItem(key="ai", done=True, detail=detail, to="/admin/ai/config")
    return SetupItem(key="ai", done=False, detail=NO_AI, to="/admin/ai/config")


def setup_checklist(db: Session, school_id: UUID, master_key: bytes) -> list[SetupItem]:
    """八项按契约顺序返回;`master_key` 只用来解 AI Key 的密文,判断 AI 是否可用。"""
    year = active_academic_year(db, school_id)
    monitor = get_switches(db, school_id).monitor
    return [
        _school(db, school_id, year),
        _year(year),
        _classes(db, school_id, year),
        _accounts(db, school_id),
        _assignments(db, school_id, year),
        _timetable(db, school_id, year, monitor),
        _cameras(db, school_id, monitor),
        _ai(db, school_id, master_key),
    ]
