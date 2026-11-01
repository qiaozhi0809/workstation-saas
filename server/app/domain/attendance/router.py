import datetime as dt
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.attendance import service
from app.domain.attendance.schemas import (
    AttendanceDay,
    AttendanceMonth,
    AttendanceUpdate,
    AttendanceUpdated,
    ConfirmRequest,
)
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.schools.service import ensure_markable_date, require_active_year, school_today
from app.domain.students.service import require_enrollment
from app.models import SchoolClass, User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["attendance"])


def _guard_write(
    db: Session,
    request: Request,
    user: User,
    bindings: list[Binding],
    class_id: UUID,
    day: dt.date,
) -> SchoolClass:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.ATTENDANCE_WRITE,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    year = require_active_year(db, cls.school_id)
    ensure_markable_date(day, school_today(db, cls.school_id), year)
    return cls


def _guard_read(
    db: Session, request: Request, user: User, bindings: list[Binding], class_id: UUID
) -> None:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.ATTENDANCE_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )


@router.get("/classes/{class_id}/attendance")
def get_day(
    class_id: UUID,
    date: dt.date,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> AttendanceDay:
    _guard_read(db, request, user, bindings, class_id)
    return service.day_view(db, class_id, date)


@router.get("/classes/{class_id}/attendance/month")
def get_month(
    class_id: UUID,
    month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")],
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> AttendanceMonth:
    _guard_read(db, request, user, bindings, class_id)
    return service.month_view(db, class_id, month)


@router.put("/classes/{class_id}/attendance/{date}/{enrollment_id}")
def put_status(
    class_id: UUID,
    date: dt.date,
    enrollment_id: UUID,
    body: AttendanceUpdate,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> AttendanceUpdated:
    _guard_write(db, request, user, bindings, class_id, date)
    enrollment = require_enrollment(db, class_id, enrollment_id)
    return service.set_status(db, class_id, enrollment, date, body, user.id)


@router.post("/classes/{class_id}/attendance/{date}/confirm")
def post_confirm(
    class_id: UUID,
    date: dt.date,
    body: ConfirmRequest,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> AttendanceDay:
    _guard_write(db, request, user, bindings, class_id, date)
    return service.confirm_day(db, class_id, date, body.clear_exceptions, user.id)
