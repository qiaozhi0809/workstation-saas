from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.preferences import service
from app.domain.preferences.schemas import Preferences
from app.models import User

router = APIRouter(prefix="/me/preferences", tags=["preferences"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=Preferences)
def get_preferences(db: DbDep, user: UserDep) -> Preferences:
    return service.get_preferences(db, user.id)


@router.put("", response_model=Preferences)
def put_preferences(body: Preferences, db: DbDep, user: UserDep) -> Preferences:
    return service.save_preferences(db, user, body)
