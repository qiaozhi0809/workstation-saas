"""`GET /meta`:版本、校名、学校时区。任何已登录用户(含家长)都能读(L74 校名、L79 时区);
强制改密期间也能读(L230):改密页要显示校名。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user_pending
from app.db import get_db
from app.models import School, User
from app.version import APP_VERSION

router = APIRouter(tags=["meta"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user_pending)]  # 强制改密中也放行(L230)


class Meta(BaseModel):
    version: str
    school_name: str
    school_tz: str


@router.get("/meta")
def get_meta(user: UserDep, db: DbDep) -> Meta:
    name, tz = db.execute(
        select(School.name, School.timezone).where(School.id == user.school_id)
    ).one()
    return Meta(version=APP_VERSION, school_name=name, school_tz=tz)
