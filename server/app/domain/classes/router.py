from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import ClassView, list_my_classes
from app.domain.schools.service import active_academic_year
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings

router = APIRouter(prefix="/me", tags=["classes"])


@router.get("/classes")
def my_classes(
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[ClassView]]:
    year = active_academic_year(db, user.school_id)
    if year is None:
        return {"items": []}
    return {"items": list_my_classes(db, bindings, year.id)}
