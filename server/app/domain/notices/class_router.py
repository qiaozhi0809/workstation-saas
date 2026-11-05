from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from redis import Redis
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.notices import service
from app.domain.notices.schemas import ClassNoticeInput, NoticeSent, NoticeSentPage
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.redis import get_redis

router = APIRouter(prefix="/classes/{class_id}/notices", tags=["class-notices"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
RedisDep = Annotated[Redis, Depends(get_redis)]
PageDep = Annotated[int, Query(ge=1, le=1000)]


@router.get("")
def list_class_notices(
    class_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    page: PageDep = 1,
) -> NoticeSentPage:
    return service.class_sent_list(db, request, user, bindings, class_id, page)


@router.post("", status_code=201)
def send_class_notice(
    class_id: UUID,
    body: ClassNoticeInput,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
) -> NoticeSent:
    return service.send_class_notice(
        db, redis, user, bindings, class_id, body, now=clock.utc_now(), request=request
    )


@router.post("/{notice_id}/recall")
def recall_class_notice(
    class_id: UUID,
    notice_id: UUID,
    request: Request,
    user: UserDep,
    bindings: BindingsDep,
    db: DbDep,
    redis: RedisDep,
) -> NoticeSent:
    return service.recall_class_notice(
        db, redis, user, bindings, class_id, notice_id, now=clock.utc_now(), request=request
    )
