import warnings
from datetime import datetime, timedelta
from uuid import UUID

import jwt
from jwt.warnings import InsecureKeyLengthWarning

from app.auth import sessions
from app.auth.tokens import decode_access_token, issue_access_token
from app.models import User
from app.rbac.roles import Role
from tests.factories import bind
from tests.helpers import freeze
from tests.seed_ids import GRADE_ID, SCHOOL_ID, TEACHER_USER_ID


def login(client, name="teacher01", pw="dev123"):
    return client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_and_me(client):
    res = login(client)
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["display_name"] == "张老师"
    me = client.get("/api/v1/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["login_name"] == "teacher01"


def test_wrong_password(client):
    res = login(client, pw="wrong")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_trims_name(client):
    assert login(client, name="  teacher01 ").status_code == 200


def test_login_too_long_password_is_401(client):
    res = login(client, pw="中" * 30)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_missing_token(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_expired_token_returns_token_expired(client, settings):
    expired = settings.model_copy(update={"access_ttl_seconds": -1})
    token, _ = issue_access_token(UUID(TEACHER_USER_ID), expired)
    res = client.get("/api/v1/auth/me", headers=bearer(token))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_refresh_then_logout_revokes(client):
    tokens = login(client).json()
    r1 = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r1.status_code == 200
    me = client.get("/api/v1/auth/me", headers=bearer(r1.json()["access_token"]))
    assert me.status_code == 200
    client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    r2 = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r2.status_code == 401
    assert r2.json()["error"]["code"] == "INVALID_REFRESH"


def test_lockout_after_five_failures(client):
    for _ in range(5):
        assert login(client, pw="wrong").status_code == 401
    res = login(client)  # 正确密码也被锁
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_success_resets_failure_counter(client):
    for _ in range(4):
        login(client, pw="wrong")
    assert login(client).status_code == 200
    for _ in range(4):
        login(client, pw="wrong")
    assert login(client).status_code == 200


def test_validation_error_does_not_echo_input(client):
    res = client.post(
        "/api/v1/auth/login",
        json={"login_name": "teacher01", "password": "p" * 300 + "SECRETMARK"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "BAD_REQUEST"
    assert "SECRETMARK" not in res.text
    errors = res.json()["error"]["details"]["errors"]
    assert errors
    for item in errors:
        assert set(item) == {"type", "loc", "msg"}


def test_lockout_lasts_full_window_after_final_failure(client, settings, redis_client):
    key = f"ws:login_fail:{SCHOOL_ID}:teacher01"
    login(client, pw="wrong")
    redis_client.expire(key, 10)
    for _ in range(4):
        login(client, pw="wrong")
    assert redis_client.ttl(key) > settings.login_lock_seconds - 5


def test_test_settings_sign_tokens_without_key_length_warning(settings):
    with warnings.catch_warnings():
        warnings.simplefilter("error", InsecureKeyLengthWarning)
        token, _ = issue_access_token(UUID(TEACHER_USER_ID), settings)
        decode_access_token(token, settings)


FROZEN = "2030-01-02T03:04:05+00:00"


def test_issue_access_token_uses_clock(monkeypatch, settings):
    freeze(monkeypatch, FROZEN)
    now = datetime.fromisoformat(FROZEN)
    token, expires_at = issue_access_token(UUID(TEACHER_USER_ID), settings)
    assert expires_at == now + timedelta(seconds=settings.access_ttl_seconds)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["iat"] == int(now.timestamp())


def test_login_sets_last_login_at_from_clock(client, db, monkeypatch):
    freeze(monkeypatch, FROZEN)
    assert login(client).status_code == 200
    user = db.get(User, UUID(TEACHER_USER_ID))
    db.refresh(user)
    assert user.last_login_at == datetime.fromisoformat(FROZEN)


def test_login_returns_contexts(client, db):
    t = login(client).json()["user"]
    assert t["contexts"] == ["teacher"]
    assert t["admin_perms"] == []
    assert t["must_change_password"] is False
    p = login(client, "principal01").json()["user"]
    assert p["contexts"] == ["admin"]
    assert p["admin_perms"][0] == "school.view"
    bind(db, UUID(TEACHER_USER_ID), Role.grade_head, grade_id=GRADE_ID)
    both = login(client).json()["user"]
    assert both["contexts"] == ["teacher", "admin"]
    assert "school.view" in both["admin_perms"]


def test_revoke_all_kills_every_refresh_token(client, settings, redis_client):
    tokens = [login(client).json()["refresh_token"] for _ in range(3)]
    assert len(set(tokens)) == 3
    assert sessions.revoke_all(redis_client, UUID(TEACHER_USER_ID), keep=tokens[1]) == 2
    codes = [
        client.post("/api/v1/auth/refresh", json={"refresh_token": t}).status_code for t in tokens
    ]
    assert codes == [401, 200, 401]


def test_logout_removes_token_from_user_set(client, redis_client):
    tokens = [login(client).json()["refresh_token"] for _ in range(2)]
    set_key = f"ws:user_refresh:{TEACHER_USER_ID}"
    assert redis_client.smembers(set_key) == set(tokens)
    client.post("/api/v1/auth/logout", json={"refresh_token": tokens[0]})
    assert redis_client.smembers(set_key) == {tokens[1]}


def test_revoke_all_counts_only_live_tokens(client, redis_client):
    tokens = [login(client).json()["refresh_token"] for _ in range(3)]
    redis_client.delete(sessions.refresh_key(tokens[0]))  # 单键过期,集合里残留
    assert sessions.revoke_all(redis_client, UUID(TEACHER_USER_ID)) == 2
    assert redis_client.smembers(f"ws:user_refresh:{TEACHER_USER_ID}") == set()
