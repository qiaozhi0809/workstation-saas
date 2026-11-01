from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Grade, SchoolClass
from app.rbac.bindings import Binding
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
    rows.sort(key=lambda r: (r.Grade.display_order, r.SchoolClass.name))
    return [
        ClassView(
            id=cls.id,
            name=cls.name,
            grade_name=grade.name,
            seat_rows=cls.seat_rows,
            seat_cols=cls.seat_cols,
            role=best[cls.id].value,
        )
        for cls, grade in rows
    ]
