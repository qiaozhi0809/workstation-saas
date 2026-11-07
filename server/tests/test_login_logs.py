import csv
import io
import json
from datetime import timedelta
from uuid import UUID

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app import clock
from app.auth import login_log, service
from app.config import Settings
from app.crypto import encrypt
from app.db import get_db
from app.deploy import scheduler as sch
from app.domain.login_logs import service as ll_service
from app.main import create_app
from app.models import LoginLog, School, User
from app.models.audit import AuditLog
from app.redis import get_redis
from tests.factories import make_teacher_account
from tests.helpers import auth
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

pytestmark = pytest.mark.usefixtures("dev_env")  # L205:这些测试经 get_settings() 读环境,显式要 dev

API = "/api/v1"
LOGS = f"{API}/admin/login-logs"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
DEAN = "55555555-5555-5555-5555-555555555544"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"


def _login(client, name="teacher01", pw="dev123", ip=None, ua=None):
    c = TestClient(client.app, client=(ip, 50000)) if ip else client
    headers = {"user-agent": ua} if ua else {}
    return c.post(f"{API}/auth/login", json={"login_name": name, "password": pw}, headers=headers)


def _rows(db) -> list[LoginLog]:
    db.expire_all()
    return list(db.scalars(select(LoginLog).order_by(LoginLog.created_at, LoginLog.id)))


def _add(db, *, at=None, school=SCHOOL_ID, user=None, name="teacher01", result="success", **kw):
    row = LoginLog(
        school_id=UUID(str(school)),
        user_id=None if user is None else UUID(str(user)),
        login_name=name,
        result=result,
        created_at=at or clock.utc_now(),
        **kw,
    )
    db.add(row)
    db.flush()
    return row


def _get(client, settings, who=IT_ADMIN, **params):
    return client.get(LOGS, params=params, headers=auth(settings, who))


# ---------- 写入 ----------


def test_success_logged(client, db):
    assert _login(client, ip="192.0.2.10", ua="UA-1").status_code == 200
    (row,) = _rows(db)
    assert (row.result, row.login_name) == ("success", "teacher01")
    assert str(row.user_id) == TEACHER_USER_ID
    assert str(row.ip) == "192.0.2.10" and row.user_agent == "UA-1"
    assert str(row.school_id) == SCHOOL_ID


def test_bad_password_logged_and_response_unchanged(client, db):
    res = _login(client, pw="wrong")
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"
    (row,) = _rows(db)
    assert row.result == "bad_password" and str(row.user_id) == TEACHER_USER_ID
    assert row.ip is None  # TestClient 的对端不是合法 IP


def test_unknown_user_logged(client, db):
    assert _login(client, name="nobody", pw="x").status_code == 401
    (row,) = _rows(db)
    assert (row.result, row.login_name, row.user_id) == ("unknown_user", "nobody", None)


def test_unknown_user_name_masked_when_not_login_shape(client, db):
    """L145:把密码误填进登录名,日志里不能原样保存(长度也不泄露)。"""
    assert _login(client, name="Sup3r-secret-pw!", pw="x", ip="10.0.0.8").status_code == 401
    (row,) = _rows(db)
    assert (row.result, row.login_name, row.user_id) == ("unknown_user", "***", None)
    # 合法形状的登录名(工号 / 手机号)照常保存,方便排查
    assert _login(client, name="13800009999", pw="x", ip="10.0.0.8").status_code == 401
    assert [r.login_name for r in _rows(db)] == ["***", "13800009999"]
    # 太短 / 带空格 / 含中文的也打码
    for odd in ("ab", "my password", "张三"):
        _login(client, name=odd, pw="x", ip="10.0.0.8")
    assert [r.login_name for r in _rows(db)][2:] == ["***", "***", "***"]


def test_unknown_user_rows_capped_per_public_ip(client, db, redis_client, monkeypatch):
    """L145:不存在的用户、来源不在内网 / 可信网段 → 每个 IP 每小时最多 20 行;仍 401、仍跑假哈希。"""
    checks: list[int] = []
    real_verify = service.verify_password
    monkeypatch.setattr(
        service, "verify_password", lambda pw, h: checks.append(1) or real_verify(pw, h)
    )
    ip = "203.0.113.9"
    for i in range(service.UNKNOWN_LOG_LIMIT + 1):
        assert _login(client, name=f"ghost{i:02d}", pw="x", ip=ip).status_code == 401
    rows = _rows(db)
    assert len(rows) == service.UNKNOWN_LOG_LIMIT and rows[-1].login_name == "ghost19"
    assert len(checks) == service.UNKNOWN_LOG_LIMIT + 1  # 第 21 次照样跑了假哈希
    assert int(redis_client.get(f"ws:login_unknown:{ip}")) == service.UNKNOWN_LOG_LIMIT + 1
    assert 0 < redis_client.ttl(f"ws:login_unknown:{ip}") <= 3600
    # 另一个公网 IP 有自己的额度;已存在用户的失败日志与它共用同一额度(L294),这个 IP 已用光
    assert _login(client, name="ghost99", pw="x", ip="198.51.100.3").status_code == 401
    assert _login(client, pw="wrong", ip=ip).status_code == 401
    assert [r.login_name for r in _rows(db)][-2:] == ["ghost19", "ghost99"]


def test_known_user_bad_password_rows_rate_limited(client, db, settings, redis_client):
    """L294:拿着一张真实登录名的名单从公网刷密码,bad_password / locked 行同样按来源 IP 每小时
    20 行封顶(与不存在的用户共用计数);响应不变(401 → 锁定后 429);内网来源不限。"""
    ip, limit, lock_at = "203.0.113.9", service.UNKNOWN_LOG_LIMIT, settings.login_max_failures
    statuses = [_login(client, pw="wrong", ip=ip).status_code for _ in range(limit + 1)]
    assert statuses[:lock_at] == [401] * lock_at and set(statuses[lock_at:]) == {429}
    rows = _rows(db)
    assert len(rows) == limit
    assert [r.result for r in rows] == ["bad_password"] * lock_at + ["locked"] * (limit - lock_at)
    assert all(str(r.user_id) == TEACHER_USER_ID for r in rows)
    assert int(redis_client.get(f"ws:login_unknown:{ip}")) == service.UNKNOWN_LOG_LIMIT + 1
    # 内网来源不限:再失败一次照样有记录
    assert _login(client, pw="wrong", ip="10.0.0.8").status_code == 429
    assert len(_rows(db)) == service.UNKNOWN_LOG_LIMIT + 1
    assert redis_client.get("ws:login_unknown:10.0.0.8") is None


def test_unknown_user_ipv6_bucketed_by_64(client, db, redis_client):
    """L145 修订:IPv6 一个用户常握有整个 /64,按单地址计数等于不限;
    同 /64 共用额度,不同 /64 各算各的。"""
    a, b = "2001:db8:1:2::10", "2001:db8:1:2:ffff::1"  # 同一 /64
    for i in range(service.UNKNOWN_LOG_LIMIT):
        assert _login(client, name=f"ghost{i:02d}", pw="x", ip=a).status_code == 401
    assert _login(client, name="ghost99", pw="x", ip=b).status_code == 401
    assert [r.login_name for r in _rows(db)][-1] == "ghost19"  # b 用光了 a 的额度
    assert redis_client.keys("ws:login_unknown:*") == ["ws:login_unknown:2001:db8:1:2::/64"]
    assert _login(client, name="ghost98", pw="x", ip="2001:db8:1:3::10").status_code == 401
    assert [r.login_name for r in _rows(db)][-1] == "ghost98"  # 另一个 /64 有自己的额度
    # IPv4 仍按单个地址
    assert _login(client, name="ghost97", pw="x", ip="203.0.113.9").status_code == 401
    assert redis_client.get("ws:login_unknown:203.0.113.9") == "1"


def test_unknown_user_rows_not_capped_on_lan(client, db, redis_client):
    for i in range(service.UNKNOWN_LOG_LIMIT + 2):
        assert _login(client, name=f"ghost{i:02d}", pw="x", ip="192.168.1.20").status_code == 401
    assert len(_rows(db)) == service.UNKNOWN_LOG_LIMIT + 2
    assert redis_client.keys("ws:login_unknown:*") == []


def test_unknown_user_rows_not_capped_from_trusted_network(
    pg_url, redis_url, db, redis_client, monkeypatch
):
    """可信代理网段内的直连地址(头缺失时的回退)不限流;经代理转来的公网来源照常限流。"""
    from tests.conftest import TEST_JWT_SECRET

    cfg = Settings(
        _env_file=None,
        env="dev",
        database_url=pg_url,
        redis_url=redis_url,
        jwt_secret=TEST_JWT_SECRET,
        trusted_proxies=["172.30.0.0/24"],
    )
    app = create_app(cfg)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    proxy = TestClient(app, client=("172.30.0.2", 50000))
    redis_client.set("ws:login_unknown:203.0.113.9", service.UNKNOWN_LOG_LIMIT)  # 额度已用完
    body = {"login_name": "ghost", "password": "x"}
    res = proxy.post(f"{API}/auth/login", json=body, headers={"X-Forwarded-For": "203.0.113.9"})
    assert res.status_code == 401 and _rows(db) == []
    assert proxy.post(f"{API}/auth/login", json=body).status_code == 401
    (row,) = _rows(db)
    assert row.login_name == "ghost" and str(row.ip) == "172.30.0.2"


def test_locked_unknown_name_rows_also_capped(client, db, settings, redis_client):
    """锁定后的 locked 行同样来自未认证请求:不存在的用户名 + 公网来源一并计入额度。"""
    ip = "203.0.113.9"
    redis_client.set(f"ws:login_unknown:{ip}", service.UNKNOWN_LOG_LIMIT)
    for _ in range(settings.login_max_failures):
        assert _login(client, name="ghost", pw="x", ip=ip).status_code == 401
    assert _login(client, name="ghost", pw="x", ip=ip).status_code == 429
    assert _rows(db) == []


def test_frozen_user_logged_inactive(client, db):
    db.query(User).filter(User.login_name == "teacher01").update({"status": "frozen"})
    db.flush()
    res = _login(client)
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"
    (row,) = _rows(db)
    assert row.result == "inactive" and str(row.user_id) == TEACHER_USER_ID


def test_locked_logged(client, db, settings):
    for _ in range(settings.login_max_failures):
        _login(client, pw="wrong")
    assert _login(client).status_code == 429
    results = [r.result for r in _rows(db)]
    assert results == ["bad_password"] * settings.login_max_failures + ["locked"]


def _turn_on(db, settings) -> str:
    secret = pyotp.random_base32()
    user = db.get(User, UUID(TEACHER_USER_ID))
    user.totp_secret = encrypt(secret, settings.master_key_bytes, aad=f"totp:{user.id}")
    user.totp_enabled_at = clock.utc_now()
    db.flush()
    return secret


def test_totp_flow_logs_only_final_outcome(client, db, settings):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    assert _rows(db) == []  # 第一步通过但还没完成:不记 success
    bad = client.post(f"{API}/auth/login/totp", json={"mfa_token": token, "code": "000000"})
    assert bad.status_code == 401
    (row,) = _rows(db)
    assert row.result == "totp_failed" and str(row.user_id) == TEACHER_USER_ID
    code = pyotp.TOTP(secret).now()
    ok = client.post(f"{API}/auth/login/totp", json={"mfa_token": token, "code": code})
    assert ok.status_code == 200
    rows = _rows(db)
    assert [r.result for r in rows] == ["totp_failed", "success"]
    dump = json.dumps([(r.login_name, r.user_agent, r.result) for r in rows])
    assert secret not in dump and token not in dump and code not in dump and "dev123" not in dump


def test_user_agent_truncated_to_300(client, db):
    _login(client, ua="u" * 500)
    (row,) = _rows(db)
    assert len(row.user_agent) == 300


def test_no_password_in_log(client, db):
    _login(client, name="teacher01", pw="Sup3r-secret-pw")
    row = _rows(db)[0]
    dump = json.dumps([row.login_name, row.user_agent, row.result, str(row.ip)])
    assert "Sup3r-secret-pw" not in dump


def test_failed_login_log_is_committed(client, db, monkeypatch):
    """失败登录的日志必须真的提交(测试会话里 commit 只放开 savepoint,所以数提交次数)。"""
    commits: list[int] = []
    real_commit = db.commit

    def counting():
        commits.append(1)
        real_commit()

    monkeypatch.setattr(db, "commit", counting)
    assert _login(client, pw="wrong").status_code == 401
    assert len(commits) >= 1
    assert [r.result for r in _rows(db)] == ["bad_password"]


def _boom(*_a, **_k):
    raise RuntimeError("log store down")


def test_log_write_failure_wrong_password_still_401(client, db, monkeypatch):
    monkeypatch.setattr(login_log, "write", _boom)
    res = _login(client, pw="wrong")
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert _login(client, name="nobody", pw="x").status_code == 401


def test_log_write_failure_success_still_200(client, db, monkeypatch):
    monkeypatch.setattr(login_log, "write", _boom)
    res = _login(client)
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"] and body["refresh_token"]


def test_log_write_failure_lock_still_429(client, db, settings, monkeypatch):
    monkeypatch.setattr(login_log, "write", _boom)
    for _ in range(settings.login_max_failures):
        assert _login(client, pw="wrong").status_code == 401
    res = _login(client)
    assert res.status_code == 429 and res.json()["error"]["code"] == "ACCOUNT_LOCKED"
    assert int(res.headers["Retry-After"]) > 0


def test_log_write_failure_totp_invalid_still_401(client, db, settings, monkeypatch):
    _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    monkeypatch.setattr(login_log, "write", _boom)
    res = client.post(f"{API}/auth/login/totp", json={"mfa_token": token, "code": "000000"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "TOTP_INVALID"


# ---------- 查询与权限 ----------


def test_login_logs_scope(client, db, settings):
    other = School(name="别校")
    db.add(other)
    db.flush()
    stranger = make_teacher_account(db, other.id)
    _add(db, user=TEACHER_USER_ID, name="teacher01")
    _add(db, school=other.id, user=stranger.id, name="spy-other-school")
    _add(db, school=other.id, name="nobody-elsewhere", result="unknown_user")
    res = _get(client, settings)
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1 and body["page"] == 1 and body["page_size"] == 50
    assert [i["login_name"] for i in body["items"]] == ["teacher01"]
    assert "spy-other-school" not in res.text
    assert body["items"][0]["user"]["display_name"]
    assert set(body["items"][0]) == {
        "id", "at", "login_name", "user", "result", "ip", "user_agent", "suspicious",
    }  # fmt: skip
    assert _get(client, settings, q="spy-other").json()["total"] == 0
    assert _get(client, settings, q=stranger.display_name).json()["total"] == 0
    assert _get(client, settings, result="unknown_user").json()["total"] == 0


def test_login_logs_permissions(client, db, settings):
    assert client.get(LOGS).status_code == 401
    assert client.get(f"{LOGS}.csv").status_code == 401
    # 排除"必须先改密码"造成的别种 403
    assert not db.get(User, UUID(TEACHER_USER_ID)).must_change_password
    assert not db.get(User, UUID(DEAN)).must_change_password
    for who in (TEACHER_USER_ID, DEAN):
        for res in (
            _get(client, settings, who),
            client.get(f"{LOGS}.csv", headers=auth(settings, who)),
        ):
            assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"
    parent_res = _login(client, name="13800000061")
    assert parent_res.status_code == 200
    h = {"Authorization": f"Bearer {parent_res.json()['access_token']}"}
    for res in (client.get(LOGS, headers=h), client.get(f"{LOGS}.csv", headers=h)):
        assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"
    assert _get(client, settings, PRINCIPAL).status_code == 200


def test_cross_school_user_id_is_not_exposed(client, db, settings):
    other = School(name="别校")
    db.add(other)
    db.flush()
    stranger = make_teacher_account(db, other.id)
    _add(db, user=stranger.id, name="local-name")
    body = _get(client, settings).json()
    assert body["total"] == 1 and body["items"][0]["user"] is None
    assert _get(client, settings, q=stranger.display_name).json()["total"] == 0
    csv_res = client.get(f"{LOGS}.csv", headers=auth(settings, IT_ADMIN))
    assert stranger.display_name not in csv_res.content.decode("utf-8-sig")


def test_empty_school_returns_empty_page(client, db, settings):
    db.execute(delete(LoginLog))
    db.flush()
    body = _get(client, settings).json()
    assert body["items"] == [] and body["total"] == 0


def test_filters(client, db, settings):
    now = clock.utc_now()
    _add(db, user=TEACHER_USER_ID, name="teacher01", result="success", suspicious=["night"])
    _add(db, name="ghost", result="unknown_user")
    _add(db, user=TEACHER_USER_ID, name="teacher01", result="bad_password")
    _add(db, user=TEACHER_USER_ID, name="teacher01", at=now - timedelta(days=10))
    assert _get(client, settings).json()["total"] == 3  # 默认近 7 天
    assert _get(client, settings, q="ghost").json()["total"] == 1
    name = db.get(User, UUID(TEACHER_USER_ID)).display_name
    assert _get(client, settings, q=name).json()["total"] == 2
    assert _get(client, settings, q="x" * 51).status_code == 400
    two = _get(client, settings, result=["success", "bad_password"]).json()
    assert two["total"] == 2
    assert _get(client, settings, result="nope").status_code == 400
    sus = _get(client, settings, suspicious=1).json()
    assert sus["total"] == 1 and sus["items"][0]["suspicious"] == ["night"]
    # 日期是学校本地日期;上海比 UTC 快 8 小时,用 UTC 日期 +-1 天的窗口覆盖十天前那条
    day = (now - timedelta(days=10)).date()
    one = _get(client, settings, **{"from": str(day - timedelta(1)), "to": str(day + timedelta(1))})
    assert one.json()["total"] == 1
    wide = _get(client, settings, **{"from": str((now - timedelta(days=30)).date())})
    assert wide.json()["total"] == 4
    assert _get(client, settings, page=0).status_code == 400
    assert _get(client, settings, page=1001).status_code == 400
    assert _get(client, settings, page=2).json()["items"] == []


def test_date_range_validation(client, db, settings):
    assert _get(client, settings, **{"from": "2026-01-01", "to": "2026-04-30"}).status_code == 400
    assert _get(client, settings, **{"from": "2026-01-01", "to": "2026-04-02"}).status_code == 200
    assert (
        _get(client, settings, **{"from": "2026-01-01", "to": "2026-04-03"}).status_code == 400
    )  # 93 天
    assert _get(client, settings, **{"from": "2026-02-01", "to": "2026-01-01"}).status_code == 400
    assert _get(client, settings, **{"from": "bad"}).status_code == 400
    assert _get(client, settings, **{"from": "1900-01-01", "to": "1900-01-02"}).status_code == 400


def test_csv_export_bom_audit_and_formula(client, db, settings):
    _add(db, user=TEACHER_USER_ID, name="=cmd|calc", result="bad_password", ip="192.0.2.5")
    res = client.get(f"{LOGS}.csv", headers=auth(settings, IT_ADMIN))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert res.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 2
    assert "'=cmd|calc" in rows[1] and "192.0.2.5" in rows[1]
    audit = db.scalars(select(AuditLog).where(AuditLog.action == "account.login_logs_export")).all()
    assert len(audit) == 1 and str(audit[0].user_id) == IT_ADMIN and audit[0].success


def test_csv_row_cap(client, db, settings, monkeypatch):
    monkeypatch.setattr(ll_service, "CSV_MAX_ROWS", 3)
    for i in range(5):
        _add(db, name=f"user{i}", result="unknown_user")
    res = client.get(f"{LOGS}.csv", headers=auth(settings, IT_ADMIN))
    assert res.status_code == 200
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 1 + 3


def test_csv_bad_params_400(client, db, settings):
    res = client.get(f"{LOGS}.csv?result=nope", headers=auth(settings, IT_ADMIN))
    assert res.status_code == 400


# ---------- 清理任务 ----------


def test_purge_job(db, settings, redis_client):
    now = clock.utc_now()
    other = School(name="别校")
    db.add(other)
    db.flush()
    db.execute(delete(LoginLog))
    old = _add(db, at=now - timedelta(days=181))
    keep = _add(db, at=now - timedelta(days=179))
    foreign = _add(db, school=other.id, at=now - timedelta(days=400))
    token = sch._school.set(UUID(SCHOOL_ID))
    try:
        summary = sch._purge_login_logs(db, redis_client, now)
    finally:
        sch._school.reset(token)
    assert summary == "删除 1 条"
    ids = set(db.scalars(select(LoginLog.id)))
    assert old.id not in ids and keep.id in ids and foreign.id in ids
    assert db.scalar(select(func.count()).select_from(LoginLog)) == 2


def test_purge_keeps_exactly_180_days(db, settings, redis_client):
    now = clock.utc_now()
    db.execute(delete(LoginLog))
    edge = _add(db, at=now - timedelta(days=180))
    older = _add(db, at=now - timedelta(days=180, seconds=1))
    token = sch._school.set(UUID(SCHOOL_ID))
    try:
        assert sch._purge_login_logs(db, redis_client, now) == "删除 1 条"
    finally:
        sch._school.reset(token)
    ids = set(db.scalars(select(LoginLog.id)))
    assert edge.id in ids and older.id not in ids
