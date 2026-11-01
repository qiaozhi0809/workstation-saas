from uuid import UUID

from app.auth.tokens import issue_access_token
from tests.seed_ids import TEACHER_USER_ID


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
