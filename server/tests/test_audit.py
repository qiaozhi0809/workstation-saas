from uuid import UUID

import pytest
from sqlalchemy import select
from starlette.requests import Request

from app.audit.service import deny, record
from app.errors import ApiError
from app.models.audit import AuditLog
from tests.seed_ids import TEACHER_USER_ID


def test_record_inserts_row(db):
    record(
        db,
        user_id=UUID(TEACHER_USER_ID),
        action="student.read_profile",
        success=True,
        object_type="student",
        object_id="x",
    )
    row = db.scalars(select(AuditLog).where(AuditLog.object_id == "x")).one()
    assert row.success is True and row.action == "student.read_profile"


def test_deny_persists_even_after_rollback(db):
    with pytest.raises(ApiError) as exc:
        deny(
            db,
            user_id=UUID(TEACHER_USER_ID),
            action="student.list",
            object_type="class",
            object_id="y",
        )
    assert exc.value.status == 403
    db.rollback()  # 模拟请求失败后的回滚
    row = db.scalars(select(AuditLog).where(AuditLog.object_id == "y")).one()
    assert row.success is False


def _request(host: str) -> Request:
    return Request(
        {
            "type": "http",
            "client": (host, 50000),
            "headers": [(b"user-agent", b"pytest-ua")],
        }
    )


def test_record_stores_ip_only_when_valid_inet(db):
    for host, oid in (("testclient", "ip-bad"), ("127.0.0.1", "ip-ok")):
        record(
            db,
            user_id=UUID(TEACHER_USER_ID),
            action="student.list",
            success=True,
            object_id=oid,
            request=_request(host),
        )
    bad = db.scalars(select(AuditLog).where(AuditLog.object_id == "ip-bad")).one()
    ok = db.scalars(select(AuditLog).where(AuditLog.object_id == "ip-ok")).one()
    assert bad.ip is None and bad.user_agent == "pytest-ua"
    assert str(ok.ip) == "127.0.0.1" and ok.user_agent == "pytest-ua"
