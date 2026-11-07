from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit.labels import ACTION_LABELS, GROUPS
from app.domain.schools.service import local_day_start_utc, school_tz
from app.errors import ApiError
from app.models import Exam, GradeExam, School, SchoolClass, Student, User
from app.models.audit import AuditLog

PAGE_SIZE = 50
MIN_DATE, MAX_DATE = date(1970, 1, 1), date(2100, 12, 31)  # 范围外的日期换算时区会溢出

# object_type -> (模型, 名称列);audit 里 user 与 account 指同一张用户表
_LABEL_SOURCES: dict[str, tuple[Any, Any]] = {
    "student": (Student, Student.name),
    "class": (SchoolClass, SchoolClass.name),
    "user": (User, User.display_name),
    "account": (User, User.display_name),
    "exam": (Exam, Exam.name),
    "school": (School, School.name),
    "grade_exam": (GradeExam, GradeExam.name),
}


class AuditRow(BaseModel):
    id: str
    at: datetime
    user_id: str | None
    user_name: str | None
    action: str
    action_label: str
    object_type: str | None
    object_id: str | None
    object_label: str | None
    ip: str | None
    success: bool
    extra: dict[str, Any] | None


class AuditPage(BaseModel):
    items: list[AuditRow]
    total: int


class AuditActionItem(BaseModel):
    action: str
    label: str


class AuditActionGroup(BaseModel):
    key: str
    label: str
    actions: list[AuditActionItem]


class AuditObjectType(BaseModel):
    key: str
    label: str


class AuditActions(BaseModel):
    groups: list[AuditActionGroup]
    object_types: list[AuditObjectType]  # 审计页"对象类型"筛选的下拉项(L271),后端一份


# 审计写入点用到过的 object_type 与中文名(L271):新增类型要同步加到这里,
# test_audit_query 会对照代码里的写入点检查
OBJECT_TYPE_LABELS: dict[str, str] = {
    "student": "学生",
    "enrollment": "学籍",
    "class": "班级",
    "grade": "年级",
    "academic_year": "学年",
    "user": "用户",
    "teacher_assignment": "教师任职",
    "role_binding": "管理岗位",
    "exam": "考试",
    "grade_exam": "年级联考",
    "review": "点评",
    "review_op": "点评操作",
    "comment": "评语",
    "growth_record": "成长记录",
    "notice": "通知",
    "school": "学校",
    "school_setting": "学校设置",
    "camera": "摄像头",
    "ai_chat": "AI 对话",
}


@dataclass
class AuditFilters:
    date_from: date | None = None
    date_to: date | None = None
    user_id: UUID | None = None
    group: str | None = None
    action: str | None = None
    object_type: str | None = None
    object_id: str | None = None
    success: bool | None = None
    page: int = 1


def actions_view() -> AuditActions:
    """denied 是按结果归类的横切分组,不列具体动作。"""
    groups = []
    for key, label, pred in GROUPS:
        actions = (
            []
            if key == "denied"
            else [
                AuditActionItem(action=a, label=name)
                for a, name in ACTION_LABELS.items()
                if pred(a, True)
            ]
        )
        groups.append(AuditActionGroup(key=key, label=label, actions=actions))
    object_types = [AuditObjectType(key=k, label=v) for k, v in OBJECT_TYPE_LABELS.items()]
    return AuditActions(groups=groups, object_types=object_types)


def _apply_group(stmt, group: str):
    for key, _label, pred in GROUPS:
        if key != group:
            continue
        if key == "denied":
            return stmt.where(AuditLog.success.is_(False))
        return stmt.where(AuditLog.action.in_([a for a in ACTION_LABELS if pred(a, True)]))
    raise ApiError(400, "INVALID_GROUP", "未知的审计分组")


def _check_date(day: date | None) -> None:
    if day is not None and not MIN_DATE <= day <= MAX_DATE:
        raise ApiError(400, "BAD_REQUEST", "日期超出范围")


def _filtered(db: Session, school_id: UUID, f: AuditFilters):
    _check_date(f.date_from)
    _check_date(f.date_to)
    stmt = select(AuditLog)
    tz = school_tz(db, school_id)
    if f.date_from is not None:
        stmt = stmt.where(AuditLog.at >= local_day_start_utc(f.date_from, tz))
    if f.date_to is not None:
        stmt = stmt.where(AuditLog.at < local_day_start_utc(f.date_to + timedelta(days=1), tz))
    if f.user_id is not None:
        stmt = stmt.where(AuditLog.user_id == f.user_id)
    if f.group is not None:
        stmt = _apply_group(stmt, f.group)
    if f.action is not None:
        stmt = stmt.where(AuditLog.action == f.action)
    if f.object_type is not None:
        stmt = stmt.where(AuditLog.object_type == f.object_type)
    if f.object_id is not None:
        stmt = stmt.where(AuditLog.object_id == f.object_id)
    if f.success is not None:
        stmt = stmt.where(AuditLog.success.is_(f.success))
    return stmt


def _as_uuid(value: str | None) -> UUID | None:
    try:
        return UUID(value) if value else None
    except ValueError:
        return None


def _object_labels(db: Session, logs: list[AuditLog]) -> dict[tuple[str, str], str]:
    """按 object_type 分组各查一次;解析不了的类型 / id 不出现在结果里。"""
    wanted: dict[str, set[UUID]] = defaultdict(set)
    for log in logs:
        oid = _as_uuid(log.object_id)
        if log.object_type in _LABEL_SOURCES and oid is not None:
            wanted[log.object_type].add(oid)
    labels: dict[tuple[str, str], str] = {}
    for object_type, ids in wanted.items():
        model, column = _LABEL_SOURCES[object_type]
        for oid, name in db.execute(select(model.id, column).where(model.id.in_(ids))):
            labels[(object_type, str(oid))] = name
    return labels


def query(db: Session, school_id: UUID, filters: AuditFilters) -> tuple[list[AuditRow], int]:
    base = _filtered(db, school_id, filters)
    # 计数子查询只选 id(L59):不把 extra 等宽列也拖进子查询
    count_q = base.with_only_columns(AuditLog.id).subquery()
    total = db.scalar(select(func.count()).select_from(count_q)) or 0
    logs = list(
        db.scalars(
            base.order_by(AuditLog.at.desc(), AuditLog.id.desc())
            .limit(PAGE_SIZE)
            .offset((max(filters.page, 1) - 1) * PAGE_SIZE)
        )
    )
    user_ids = {log.user_id for log in logs if log.user_id is not None}
    names = (
        dict(db.execute(select(User.id, User.display_name).where(User.id.in_(user_ids))).all())
        if user_ids
        else {}
    )
    object_labels = _object_labels(db, logs)
    rows = [
        AuditRow(
            id=str(log.id),
            at=log.at,
            user_id=None if log.user_id is None else str(log.user_id),
            user_name=names.get(log.user_id),
            action=log.action,
            action_label=ACTION_LABELS.get(log.action, log.action),
            object_type=log.object_type,
            object_id=log.object_id,
            object_label=object_labels.get((log.object_type or "", str(_as_uuid(log.object_id)))),
            ip=None if log.ip is None else str(log.ip),
            success=log.success,
            extra=log.extra,
        )
        for log in logs
    ]
    return rows, total
