from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import select
from starlette.requests import Request

from app.audit.service import _client_ip, deny, record
from app.config import Settings
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


def _proxied_request(peer: str, xff: str | list[str] | None, proxies: list[str]) -> Request:
    lines = [xff] if isinstance(xff, str) else (xff or [])
    headers = [(b"x-forwarded-for", line.encode()) for line in lines]
    app = SimpleNamespace(
        state=SimpleNamespace(settings=Settings(_env_file=None, trusted_proxies=proxies))
    )
    return Request({"type": "http", "client": (peer, 50000), "headers": headers, "app": app})


def test_ip_from_trusted_proxy():
    trusted = ["127.0.0.1", "10.0.0.0/8"]
    # 右往左:10.0.0.5 可信跳过,取第一个不可信的 203.0.113.9(最左的伪造值不会被采信)
    req = _proxied_request("127.0.0.1", "198.51.100.1, 203.0.113.9, 10.0.0.5", trusted)
    assert _client_ip(req) == "203.0.113.9"
    # 单个值
    assert _client_ip(_proxied_request("10.1.2.3", "203.0.113.7", trusted)) == "203.0.113.7"
    # 全是可信地址:回退直连地址
    assert _client_ip(_proxied_request("127.0.0.1", "10.0.0.5, 10.0.0.6", trusted)) == "127.0.0.1"
    # 没有该头:直连地址
    assert _client_ip(_proxied_request("127.0.0.1", None, trusted)) == "127.0.0.1"
    # IPv6
    assert _client_ip(_proxied_request("127.0.0.1", "2001:db8::1", trusted)) == "2001:db8::1"


def test_ip_ignores_xff_from_untrusted():
    xff = "203.0.113.9"
    assert _client_ip(_proxied_request("198.51.100.20", xff, [])) == "198.51.100.20"
    assert _client_ip(_proxied_request("198.51.100.20", xff, ["10.0.0.0/8"])) == "198.51.100.20"


def test_ip_bad_xff():
    trusted = ["127.0.0.1"]
    for bad in ("garbage", "203.0.113.9, garbage", "", "unknown", "300.1.1.1"):
        assert _client_ip(_proxied_request("127.0.0.1", bad, trusted)) == "127.0.0.1"


def test_ip_rejects_scope_id():
    trusted = ["127.0.0.1"]
    # 直连地址带 scope id:非法 → None;XFF 里带 scope id:非法 → 回退直连地址
    assert _client_ip(_proxied_request("fe80::1%eth0", None, trusted)) is None
    assert _client_ip(_proxied_request("127.0.0.1", "fe80::1%eth0", trusted)) == "127.0.0.1"
    assert _client_ip(_proxied_request("127.0.0.1", "203.0.113.9, fe80::1%eth0", trusted)) == (
        "127.0.0.1"
    )


def test_ip_normalizes_ipv4_mapped():
    # 映射地址先归一成 IPv4 再判断是否可信,返回值也是 IPv4
    assert _client_ip(_proxied_request("::ffff:198.51.100.7", None, [])) == "198.51.100.7"
    trusted = ["10.0.0.0/8"]
    req = _proxied_request("::ffff:10.0.0.1", "203.0.113.9", trusted)
    assert _client_ip(req) == "203.0.113.9"
    req = _proxied_request("10.0.0.1", "::ffff:203.0.113.9, ::ffff:10.0.0.2", trusted)
    assert _client_ip(req) == "203.0.113.9"


def test_ai_generate_audit_uses_trusted_proxy_ip(client, settings, db):
    from starlette.testclient import TestClient

    from tests.helpers import auth
    from tests.test_ai_chats import (
        configure_ai,
        create,
        generate_audits,
        parent_body,
        set_transport,
    )

    configure_ai(db, settings)
    set_transport(client, ["【学生01】进步很大"])
    chat = create(client, settings, parent_body())
    # 反向代理 10.0.0.1 直连,真实客户端 203.0.113.9
    client.app.state.settings = Settings(
        _env_file=None,
        database_url=settings.database_url,
        redis_url=settings.redis_url,
        jwt_secret=settings.jwt_secret,
        trusted_proxies=["10.0.0.0/8"],
    )
    proxied = TestClient(client.app, client=("10.0.0.1", 50000))
    with proxied.stream(
        "POST",
        f"/api/v1/ai/chats/{chat['id']}/reply",
        headers={**auth(settings), "X-Forwarded-For": "203.0.113.9"},
        json={},
    ) as r:
        assert r.status_code == 200
        r.read()
    rows = generate_audits(db, chat["id"])
    assert len(rows) == 1 and str(rows[0].ip) == "203.0.113.9"


def test_ip_multiple_xff_header_lines():
    trusted = ["127.0.0.1", "10.0.0.0/8"]
    # 分开追加的两行等价于 "198.51.100.1, 203.0.113.9, 10.0.0.5":右往左取 203.0.113.9
    req = _proxied_request("127.0.0.1", ["198.51.100.1, 203.0.113.9", "10.0.0.5"], trusted)
    assert _client_ip(req) == "203.0.113.9"
    # 只看第一行会得到伪造的 198.51.100.1;最后一行是客户端自带时,以最右的不可信值为准
    req = _proxied_request("127.0.0.1", ["198.51.100.1", "203.0.113.9"], trusted)
    assert _client_ip(req) == "203.0.113.9"
