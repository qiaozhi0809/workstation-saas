from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.classes.sort import class_sort_key
from app.errors import ApiError
from app.models import Grade, SchoolClass
from app.rbac.bindings import Binding, Scope
from app.rbac.roles import TEACHER_ROLES, Role

TeacherRole = Literal["homeroom_teacher", "subject_teacher", "assistant_teacher"]

# Highest priority first.
_ROLE_PRIORITY = (Role.homeroom_teacher, Role.assistant_teacher, Role.subject_teacher)


class ClassView(BaseModel):
    id: UUID
    name: str
    grade_name: str
    seat_rows: int
    seat_cols: int
    role: TeacherRole
    desk_size: Literal[1, 2, 3]
    seat_layout: Literal["auto", "manual"]
    seat_order: Literal["row", "col"]
    podium_left: int
    podium_right: int
    room: str


def list_my_classes(db: Session, bindings: Sequence[Binding], year_id: UUID) -> list[ClassView]:
    best: dict[UUID, Role] = {}
    for bd in bindings:
        class_id = bd.scope.class_id
        if bd.role not in TEACHER_ROLES or class_id is None or bd.academic_year_id != year_id:
            continue
        current = best.get(class_id)
        if current is None or _ROLE_PRIORITY.index(bd.role) < _ROLE_PRIORITY.index(current):
            best[class_id] = bd.role
    if not best:
        return []
    rows = db.execute(
        select(SchoolClass, Grade)
        .join(Grade, SchoolClass.grade_id == Grade.id)
        .where(SchoolClass.id.in_(best))
    ).all()
    # 年级按 display_order,同年级班名按数值排(L40:三年二班 < 三年三班 < 三年十班),id 收尾保证稳定
    rows.sort(
        key=lambda r: (
            r.Grade.display_order,
            class_sort_key(r.Grade.name),
            class_sort_key(r.SchoolClass.name),
            str(r.SchoolClass.id),
        )
    )
    return [
        ClassView(
            id=cls.id,
            name=cls.name,
            grade_name=grade.name,
            seat_rows=cls.seat_rows,
            seat_cols=cls.seat_cols,
            role=best[cls.id].value,
            desk_size=cls.desk_size,
            seat_layout=cls.seat_layout,
            seat_order=cls.seat_order,
            podium_left=cls.podium_left,
            podium_right=cls.podium_right,
            room=cls.room,
        )
        for cls, grade in rows
    ]


def get_class_or_404(db: Session, class_id: UUID) -> SchoolClass:
    cls = db.get(SchoolClass, class_id)
    if cls is None:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    return cls


def class_scope_of(cls: SchoolClass) -> Scope:
    return Scope(school_id=cls.school_id, grade_id=cls.grade_id, class_id=cls.id)
