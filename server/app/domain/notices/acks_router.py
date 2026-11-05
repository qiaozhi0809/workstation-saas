from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app import clock
from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.notices import acks
from app.domain.notices.schemas import AckInput, AckStats
from app.models import User

router = APIRouter(prefix="/notices", tags=["notice-acks"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/{notice_id}/ack", status_code=204)
def submit(notice_id: UUID, body: AckInput, request: Request, user: UserDep, db: DbDep) -> Response:
    acks.submit_ack(db, user, notice_id, body, now=clock.utc_now(), request=request)
    return Response(status_code=204)


@router.get("/{notice_id}/acks")
def stats(notice_id: UUID, user: UserDep, db: DbDep) -> AckStats:
    return acks.ack_stats(db, user, notice_id)


@router.get("/{notice_id}/acks/export")
def export(notice_id: UUID, request: Request, user: UserDep, db: DbDep) -> Response:
    text = acks.ack_csv(db, user, notice_id, request)
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"acks.csv\"; filename*=UTF-8''{quote('回执.csv')}"
            ),
            "Cache-Control": "no-store",
        },
    )
