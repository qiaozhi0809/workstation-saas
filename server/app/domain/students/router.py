from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.audit.service import deny, record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.schools.service import active_academic_year
from app.domain.students.schemas import StudentProfile, StudentSeat
from app.domain.students.service import (
    build_profile,
    class_scope,
    find_enrolled_student,
    list_roster,
)
from app.errors import ApiError
from app.models import User
from app.rbac.bindings import Binding, can
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["students"])


@router.get("/classes/{class_id}/students")
def class_students(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[StudentSeat]]:
    scope = class_scope(db, class_id)
    if scope is None:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    if not can(bindings, Perm.STUDENT_LIST, scope):
        deny(
            db,
            user_id=user.id,
            action="student.list",
            object_type="class",
            object_id=str(class_id),
            request=request,
        )
    year = active_academic_year(db, user.school_id)
    if year is None:
        return {"items": []}
    return {"items": list_roster(db, class_id, year.id)}


@router.get("/students/{student_id}", response_model_exclude_none=True)
def student_profile(
    student_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentProfile:
    year = active_academic_year(db, user.school_id)
    found = find_enrolled_student(db, student_id, year.id) if year is not None else None
    if found is None:
        raise ApiError(404, "NOT_FOUND", "学生不存在")
    student, scope = found
    if not can(bindings, Perm.STUDENT_BASIC, scope):
        deny(
            db,
            user_id=user.id,
            action="student.read_profile",
            object_type="student",
            object_id=str(student_id),
            request=request,
        )
    profile = build_profile(student, scope, bindings, user.id)
    record(
        db,
        user_id=user.id,
        action="student.read_profile",
        success=True,
        object_type="student",
        object_id=str(student_id),
        request=request,
    )
    db.commit()
    return profile
