"""学年升级的 HTTP 端点(权限点 `year.upgrade`):suggest / preview / 执行 / latest / 回滚。

所有响应都完整输出每个字段(包括 null 与空数组):前端类型里它们是必填的,
所以这里不使用 `response_model_exclude_*`。
"""

from datetime import datetime
from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.years import service
from app.domain.years.plan import NewYear, UpgradePlan
from app.domain.years.service import UpgradeError, UpgradePreview
from app.domain.years.suggest import suggest
from app.errors import ApiError
from app.models import User
from app.rbac.admin import ensure_admin
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.roles import Perm

router = APIRouter(prefix="/admin/years/upgrade", tags=["years"])

Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]

_STATUS = {
    service.INVALID: 400,
    service.STALE: 409,
    service.NOTHING_TO_ROLLBACK: 409,
    service.HAS_DATA: 409,
    "NO_ACTIVE_YEAR": 409,
}


class UpgradeDone(BaseModel):
    upgrade_id: UUID
    new_year_id: UUID


class UpgradeLatest(BaseModel):
    id: UUID
    executed_at: datetime
    from_year_name: str
    to_year_name: str
    rolled_back: bool


class Ok(BaseModel):
    ok: bool = True


def _raise(e: UpgradeError) -> NoReturn:
    raise ApiError(_STATUS.get(e.code, 400), e.code, e.message, e.details) from e


def _guard(db: Session, request: Request, user: User, bindings: list[Binding]) -> None:
    ensure_admin(db, request, user.id, bindings, Perm.YEAR_UPGRADE, user.school_id)


def _normalize_teacher_ids(db: Session, school_id: UUID, plan: UpgradePlan) -> UpgradePlan:
    """班主任 id 归一:前端选人接口只给 user_id,方案里要的是 teachers.id。

    本校某个有 teachers 行的 users.id 换成对应的 teachers.id;已经是 teachers.id 的原样不动。
    """
    given = {
        t
        for t in [c.homeroom_teacher_id for c in plan.classes]
        + [n.homeroom_teacher_id for n in plan.new_classes]
        if t is not None
    }
    if not given:
        return plan
    to_teacher = {
        r.user_id: r.teacher_id
        for r in db.execute(
            text(
                "SELECT u.id AS user_id, t.id AS teacher_id FROM teachers t"
                " JOIN users u ON u.id = t.user_id"
                " WHERE u.school_id = :s AND u.id = ANY(:ids)"
            ),
            {"s": school_id, "ids": list(given)},
        )
    }
    if not to_teacher:
        return plan
    out = plan.model_copy(deep=True)
    for item in [*out.classes, *out.new_classes]:
        if item.homeroom_teacher_id in to_teacher:
            item.homeroom_teacher_id = to_teacher[item.homeroom_teacher_id]
    return out


@router.post("/suggest")
def post_suggest(
    body: NewYear, request: Request, user: Auth, bindings: Bind, db: Db
) -> UpgradePlan:
    _guard(db, request, user, bindings)
    try:
        return suggest(db, user.school_id, body.name, body.start_date, body.end_date)
    except UpgradeError as e:
        _raise(e)


@router.post("/preview")
def post_preview(
    body: UpgradePlan, request: Request, user: Auth, bindings: Bind, db: Db
) -> UpgradePreview:
    _guard(db, request, user, bindings)
    try:
        plan = _normalize_teacher_ids(db, user.school_id, body)
        return service.preview(db, user.school_id, plan)
    except UpgradeError as e:
        _raise(e)


@router.post("", status_code=201)
def post_upgrade(
    body: UpgradePlan, request: Request, user: Auth, bindings: Bind, db: Db
) -> UpgradeDone:
    _guard(db, request, user, bindings)
    try:
        plan = _normalize_teacher_ids(db, user.school_id, body)
        up = service.apply(
            db,
            user.school_id,
            plan,
            now=clock.utc_now(),
            actor_id=user.id,
            request=request,
            via="http",
        )
    except UpgradeError as e:
        _raise(e)
    assert up.to_year_id is not None
    return UpgradeDone(upgrade_id=up.id, new_year_id=up.to_year_id)


@router.get("/latest")
def get_latest(request: Request, user: Auth, bindings: Bind, db: Db) -> UpgradeLatest | None:
    _guard(db, request, user, bindings)
    row = db.execute(
        text(
            "SELECT y.id, y.executed_at, y.rolled_back_at, y.plan, a.name AS from_year_name"
            " FROM year_upgrades y JOIN academic_years a ON a.id = y.from_year_id"
            " WHERE y.school_id = :s ORDER BY y.executed_at DESC, y.created_at DESC LIMIT 1"
        ),
        {"s": user.school_id},
    ).first()
    if row is None:
        return None
    return UpgradeLatest(
        id=row.id,
        executed_at=row.executed_at,
        from_year_name=row.from_year_name,
        to_year_name=row.plan["new_year"]["name"],
        rolled_back=row.rolled_back_at is not None,
    )


@router.post("/rollback")
def post_rollback(request: Request, user: Auth, bindings: Bind, db: Db) -> Ok:
    _guard(db, request, user, bindings)
    try:
        service.rollback(
            db, user.school_id, now=clock.utc_now(), actor_id=user.id, request=request, via="http"
        )
    except UpgradeError as e:
        _raise(e)
    return Ok()
