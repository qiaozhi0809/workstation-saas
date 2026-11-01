from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.schools.service import active_academic_year
from app.models import User
from app.rbac.bindings import Binding, load_bindings


def get_bindings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[Binding]:
    year = active_academic_year(db, user.school_id)
    return load_bindings(db, user.id, year.id if year else None)
