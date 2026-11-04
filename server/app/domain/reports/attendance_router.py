from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.overview.service import ensure_school_view
from app.domain.reports import attendance as service
from app.domain.reports.attendance import (
    MONTH_PATTERN,
    AttendanceClassDetail,
    AttendanceReport,
)
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings

router = APIRouter(prefix="/admin", tags=["reports"])

Month = Annotated[str | None, Query(pattern=MONTH_PATTERN)]


@router.get("/reports/attendance")
def get_attendance_report(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
    month: Month = None,
    grade_id: UUID | None = None,
) -> AttendanceReport:
    ensure_school_view(db, request, user, bindings)
    resolved = service.resolve_month(db, user.school_id, month)
    return service.month_report(db, bindings, resolved, grade_id, user=user)


@router.get("/reports/attendance/class")
def get_attendance_class(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
    month: Month = None,
) -> AttendanceClassDetail:
    ensure_school_view(db, request, user, bindings)
    resolved = service.resolve_month(db, user.school_id, month)
    return service.class_detail(db, bindings, resolved, class_id, user=user, request=request)


@router.get("/reports/attendance/export")
def export_attendance(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
    month: Month = None,
    grade_id: UUID | None = None,
) -> Response:
    ensure_school_view(db, request, user, bindings)
    resolved = service.resolve_month(db, user.school_id, month)
    report = service.month_report(db, bindings, resolved, grade_id, user=user)
    record(
        db,
        user_id=user.id,
        action="attendance.export",
        success=True,
        object_type="school",
        object_id=str(user.school_id),
        request=request,
        extra={"month": resolved, "grade_id": None if grade_id is None else str(grade_id)},
    )
    db.commit()
    # UTF-8 BOM 让 Excel 正确识别中文
    body = "\ufeff" + service.export_csv(report)
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="attendance-{resolved}.csv"'},
    )
