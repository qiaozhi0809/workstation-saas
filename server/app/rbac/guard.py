from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.audit.service import deny
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import Perm


def ensure(
    db: Session,
    request: Request | None,
    user_id: UUID,
    bindings: Sequence[Binding],
    perm: Perm,
    scope: Scope,
    *,
    object_id: str,
    object_type: str = "class",
) -> None:
    if not can(bindings, perm, scope):
        deny(
            db,
            user_id=user_id,
            action=perm.value,
            object_type=object_type,
            object_id=object_id,
            request=request,
        )
