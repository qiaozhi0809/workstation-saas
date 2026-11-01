from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.clock
from app.auth.tokens import issue_access_token
from app.models import Enrollment
from app.models.audit import AuditLog
from tests.seed_ids import TEACHER_USER_ID


def auth(settings, user_id: str | UUID = TEACHER_USER_ID) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_access_token(UUID(str(user_id)), settings)[0]}"}


def audit_rows(db: Session, object_id: str | UUID) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.object_id == str(object_id))).all())


def enrollment_of(db: Session, student_id: str | UUID) -> UUID:
    return db.scalars(
        select(Enrollment.id).where(
            Enrollment.student_id == UUID(str(student_id)), Enrollment.status == "active"
        )
    ).one()


def freeze(monkeypatch, iso: str) -> None:
    monkeypatch.setattr(app.clock, "utc_now", lambda: datetime.fromisoformat(iso))
