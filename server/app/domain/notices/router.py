from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from redis import Redis
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.notices import service
from app.domain.notices.schemas import (
    Inbox,
    NoticeInput,
    NoticeOptions,
    NoticePerson,
    NoticeRecipients,
    NoticeSent,
    NoticeSentPage,
)
from app.domain.schools.service import require_active_year
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.redis import get_redis

admin_router = APIRouter(prefix="/admin/notices", tags=["admin-notices"])
inbox_router = APIRouter(prefix="/notices", tags=["notices"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
RedisDep = Annotated[Redis, Depends(get_redis)]
PageDep = Annotated[int, Query(ge=1, le=1000)]

# 发布实时事件的是同步端点(def):publish 是阻塞的 Redis 调用,交给线程池,不卡事件循环。


@admin_router.get("/people")
def notice_people(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    q: Annotated[str, Query(max_length=50)] = "",
) -> list[NoticePerson]:
    service.ensure_sender(db, request, user, bindings)
    return service.people(db, user, bindings, q)


@admin_router.get("/options")
def notice_options(
    request: Request, user: UserDep, bindings: BindingsDep, db: DbDep
) -> NoticeOptions:
    service.ensure_sender(db, request, user, bindings)
    year = require_active_year(db, user.school_id)
    return service.send_options(db, user, bindings, year)


@admin_router.post("", status_code=201)
def send_notice(
    body: NoticeInput,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
) -> NoticeSent:
    service.ensure_sender(db, request, user, bindings)
    return service.send(db, redis, user, bindings, body, now=clock.utc_now(), request=request)


@admin_router.get("")
def list_sent(
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    page: PageDep = 1,
) -> NoticeSentPage:
    service.ensure_sender(db, request, user, bindings)
    return service.sent_list(db, user, page)


@admin_router.get("/{notice_id}/recipients")
def notice_recipients(
    notice_id: UUID, request: Request, user: UserDep, bindings: BindingsDep, db: DbDep
) -> NoticeRecipients:
    service.ensure_sender(db, request, user, bindings)
    return service.recipients_of(db, user, notice_id)


@admin_router.post("/{notice_id}/recall")
def recall_notice(
    notice_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
) -> NoticeSent:
    service.ensure_sender(db, request, user, bindings)
    return service.recall(db, redis, user, notice_id, now=clock.utc_now(), request=request)


@inbox_router.get("")
def get_inbox(user: UserDep, db: DbDep, page: PageDep = 1) -> Inbox:
    return service.inbox(db, user, page, now=clock.utc_now())


@inbox_router.post("/read-all", status_code=204)
def read_all(user: UserDep, db: DbDep) -> Response:
    service.mark_all_read(db, user, now=clock.utc_now())
    return Response(status_code=204)


@inbox_router.post("/{notice_id}/read", status_code=204)
def read_one(notice_id: UUID, user: UserDep, db: DbDep) -> Response:
    service.mark_read(db, user, notice_id, now=clock.utc_now())
    return Response(status_code=204)


router = APIRouter()
router.include_router(admin_router)
router.include_router(inbox_router)
