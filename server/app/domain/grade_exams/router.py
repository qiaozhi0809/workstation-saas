from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.grade_exams import service
from app.domain.grade_exams.schemas import GradeExamInput, GradeExamOut
from app.domain.overview.service import ensure_school_view
from app.domain.schools.service import require_active_year
from app.models import GradeExam, User
from app.rbac.admin import admin_perms, ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(prefix="/admin/grade-exams", tags=["grade-exams"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]


def _write(
    db: Session, request: Request, user: User, bindings: list[Binding], grade_id: UUID | None
) -> None:
    ensure_admin(
        db, request, user.id, bindings, Perm.GRADE_EXAM_WRITE, user.school_id, grade_id=grade_id
    )


def _locked_for_write(
    db: Session, request: Request, user: User, bindings: list[Binding], grade_exam_id: UUID
) -> GradeExam:
    """先判权再加锁(L38):没有任何 grade_exam.write 的人对任何 id 一律 403(不借 404 探联考是否存在),
    再按联考所属年级判权,通过后才取行锁。"""
    if Perm.GRADE_EXAM_WRITE.value not in admin_perms(bindings):
        _write(db, request, user, bindings, None)
    ge = service.get_grade_exam(db, user.school_id, grade_exam_id)
    _write(db, request, user, bindings, ge.grade_id)
    return service.get_grade_exam(db, user.school_id, grade_exam_id, lock=True)


@router.get("")
def list_grade_exams(
    request: Request, user: Auth, bindings: Bind, db: Db, grade_id: UUID | None = None
) -> list[GradeExamOut]:
    ensure_school_view(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.list_grade_exams(db, bindings, year, grade_id)


@router.post("", status_code=201)
def create_grade_exam(
    body: GradeExamInput, request: Request, user: Auth, bindings: Bind, db: Db
) -> GradeExamOut:
    _write(db, request, user, bindings, body.grade_id)
    return service.create(db, user, body, now=clock.utc_now(), request=request)


@router.put("/{grade_exam_id}")
def update_grade_exam(
    grade_exam_id: UUID,
    body: GradeExamInput,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
) -> GradeExamOut:
    ge = _locked_for_write(db, request, user, bindings, grade_exam_id)
    return service.update(db, user, ge, body, now=clock.utc_now(), request=request)


@router.delete("/{grade_exam_id}", status_code=204)
def delete_grade_exam(
    grade_exam_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db
) -> Response:
    ge = _locked_for_write(db, request, user, bindings, grade_exam_id)
    service.delete_grade_exam(db, user, ge, request=request)
    return Response(status_code=204)


@router.post("/{grade_exam_id}/sync")
def sync_grade_exam(
    grade_exam_id: UUID, request: Request, user: Auth, bindings: Bind, db: Db
) -> GradeExamOut:
    ge = _locked_for_write(db, request, user, bindings, grade_exam_id)
    return service.sync(db, user, ge, now=clock.utc_now(), request=request)
