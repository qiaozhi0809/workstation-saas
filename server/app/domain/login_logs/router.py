from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.login_logs import service
from app.domain.login_logs.service import Filters, LoginLogPage, ResultName
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(tags=["login-logs"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
DateFrom = Annotated[date | None, Query(alias="from")]
DateTo = Annotated[date | None, Query(alias="to")]
SearchQ = Annotated[str | None, Query(max_length=50)]
Results = Annotated[list[ResultName] | None, Query()]
Suspicious = Annotated[int | None, Query(ge=0, le=1)]


@router.get("/admin/login-logs")
def login_logs(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    q: SearchQ = None,
    result: Results = None,
    suspicious: Suspicious = None,
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
) -> LoginLogPage:
    ensure_admin(db, request, user.id, bindings, Perm.AUDIT_READ, settings.school_id)
    filters = Filters(date_from, date_to, q, result, suspicious == 1)
    return service.query(db, settings.school_id, filters, page)


@router.get("/admin/login-logs.csv")
def login_logs_csv(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    settings: SettingsDep,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    q: SearchQ = None,
    result: Results = None,
    suspicious: Suspicious = None,
) -> Response:
    ensure_admin(db, request, user.id, bindings, Perm.AUDIT_READ, settings.school_id)
    filters = Filters(date_from, date_to, q, result, suspicious == 1)
    text, count = service.export_csv(db, settings.school_id, filters)
    record(
        db,
        user_id=user.id,
        action="account.login_logs_export",
        success=True,
        object_type="school",
        object_id=str(settings.school_id),
        request=request,
        extra={"rows": count},
    )
    db.commit()
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"login-logs.csv\"; filename*=UTF-8''{quote('登录日志.csv')}"
            ),
            "Cache-Control": "no-store",
        },
    )
