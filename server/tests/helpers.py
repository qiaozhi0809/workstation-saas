from datetime import datetime
from unittest import mock
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.clock
from app.auth.tokens import issue_access_token
from app.models import Enrollment
from app.models.audit import AuditLog
from tests.seed_ids import TEACHER_USER_ID

_REAL_UTC_NOW = app.clock.utc_now  # 在任何 freeze 之前捕获


def auth(settings, user_id: str | UUID = TEACHER_USER_ID) -> dict[str, str]:
    # 令牌按真实时间签发:PyJWT 用真实时钟校验 exp,冻结到过去的测试不能让令牌过期
    with mock.patch.object(app.clock, "utc_now", _REAL_UTC_NOW):
        token = issue_access_token(UUID(str(user_id)), settings)[0]
    return {"Authorization": f"Bearer {token}"}


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
