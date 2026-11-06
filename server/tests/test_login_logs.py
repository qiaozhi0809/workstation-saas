import csv
import io
import json
from datetime import timedelta
from uuid import UUID

import pyotp
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app import clock
from app.crypto import encrypt
from app.deploy import scheduler as sch
from app.models import LoginLog, School, User
from app.models.audit import AuditLog
from tests.factories import make_teacher_account
from tests.helpers import auth
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

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
    for who in (TEACHER_USER_ID, DEAN):
        assert _get(client, settings, who).status_code == 403
        assert client.get(f"{LOGS}.csv", headers=auth(settings, who)).status_code == 403
    parent = _login(client, name="13800000061").json()["access_token"]
    h = {"Authorization": f"Bearer {parent}"}
    assert client.get(LOGS, headers=h).status_code == 403
    assert client.get(f"{LOGS}.csv", headers=h).status_code == 403
    assert _get(client, settings, PRINCIPAL).status_code == 200


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
