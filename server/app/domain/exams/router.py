from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.exams.schemas import SubjectFull
from app.domain.exams.subjects import class_subjects
from app.models import User
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(tags=["exams"])


@router.get("/classes/{class_id}/subjects")
def list_subjects(
    class_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    bindings: Annotated[list[Binding], Depends(get_bindings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[SubjectFull]]:
    cls = get_class_or_404(db, class_id)
    ensure(
        db,
        request,
        user.id,
        bindings,
        Perm.EXAM_READ,
        class_scope_of(cls),
        object_id=str(class_id),
    )
    return {"items": class_subjects(db, cls)}
