import pytest
from sqlalchemy import select

from app.auth.passwords import check_policy, generate_temp_password
from app.errors import ApiError
from app.models import User
from app.models.audit import AuditLog
from app.rbac.roles import Role
from tests.factories import bind, make_user
from tests.helpers import audit_rows

URL = "/api/v1/auth/password"


def login(client, name="teacher01", pw="dev123"):
    return client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def forced_user(db, name="forced01"):
    user = make_user(db, name)
    user.must_change_password = True
    bind(db, user.id, Role.homeroom_teacher, class_id="44444444-4444-4444-4444-444444444444")
    db.commit()
    return user


def test_must_change_blocks_other_endpoints(client, db):
    forced_user(db)
    tokens = login(client, "forced01").json()
    assert tokens["user"]["must_change_password"] is True
    h = bearer(tokens["access_token"])
    blocked = client.get("/api/v1/me/classes", headers=h)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    me = client.get("/api/v1/auth/me", headers=h)
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True
    assert me.json()["login_name"] == "forced01"
    ref = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert ref.status_code == 200
    out = client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert out.status_code == 200


def _change(client, token, refresh, old, new):
    return client.post(
        URL,
        headers=bearer(token),
        json={"old_password": old, "new_password": new, "refresh_token": refresh},
    )


def test_change_password_policy(client):
    t = login(client).json()
    a, r = t["access_token"], t["refresh_token"]
    res = _change(client, a, r, "dev123", "abcdefgh")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "PASSWORD_WEAK"
    assert res.json()["error"]["details"]["reason"] == "one_kind"
    res = _change(client, a, r, "dev123", "ab12")
    assert res.json()["error"]["details"]["reason"] == "too_short"
    res = _change(client, a, r, "dev123", "dev123")
    assert res.json()["error"]["details"]["reason"] == "same_as_old"
    res = _change(client, a, r, "wrong-old", "abcd1234")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WRONG_PASSWORD"


def test_check_policy_edges():
    check_policy("abcd1234")
    check_policy("abcd!!!!")
    cases = [("12345678", "one_kind"), ("!!!!!!!!", "one_kind"), ("short1", "too_short")]
    for bad, reason in cases:
        with pytest.raises(ApiError) as exc:
            check_policy(bad)
        assert exc.value.details["reason"] == reason


def test_too_long_password_over_http(client):
    t = login(client).json()
    res = _change(client, t["access_token"], t["refresh_token"], "dev123", "中" * 25 + "a1")
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "PASSWORD_WEAK"
    assert err["details"]["reason"] == "too_long"
    assert err["message"] == "密码不能超过 72 个字节"


def test_validation_error_does_not_echo_passwords(client):
    t = login(client).json()
    long_pw = "SECRETpw1" * 40
    res = _change(client, t["access_token"], t["refresh_token"], long_pw, long_pw)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "BAD_REQUEST"
    assert "SECRETpw1" not in res.text


def test_change_password_keeps_current_session_only(client, db, redis_client):
    forced_user(db)
    a = login(client, "forced01").json()
    b = login(client, "forced01").json()
    new_pw = "Newpass-9x"
    res = _change(client, a["access_token"], a["refresh_token"], "dev123", new_pw)
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert (
        client.post("/api/v1/auth/refresh", json={"refresh_token": a["refresh_token"]}).status_code
        == 200
    )
    assert (
        client.post("/api/v1/auth/refresh", json={"refresh_token": b["refresh_token"]}).status_code
        == 401
    )
    user = db.scalars(select(User).where(User.login_name == "forced01")).one()
    assert user.must_change_password is False
    assert client.get("/api/v1/me/classes", headers=bearer(a["access_token"])).status_code == 200
    assert login(client, "forced01", new_pw).status_code == 200
    rows = audit_rows(db, user.id)
    assert [r.action for r in rows] == ["account.password_change"]
    assert rows[0].success is True
    blob = repr(rows[0].extra)
    for secret in ("dev123", new_pw, a["refresh_token"], b["refresh_token"]):
        assert secret not in blob
    all_audit = " ".join(repr(r.extra) for r in db.scalars(select(AuditLog)).all())
    assert new_pw not in all_audit


def test_temp_password_shape():
    for _ in range(200):
        pw = generate_temp_password()
        assert len(pw) == 10
        assert sum(c.isalpha() for c in pw) >= 3
        assert sum(c.isdigit() for c in pw) >= 3
        assert not set(pw) & set("IlOo01")
        assert pw.isascii() and pw.isalnum()
        check_policy(pw)


def _fail_key(settings, name="teacher01"):
    return f"ws:login_fail:{settings.school_id}:{name}"


def test_wrong_old_password_locks_after_max_failures(client, settings, redis_client):
    t = login(client).json()
    a, r = t["access_token"], t["refresh_token"]
    for _ in range(settings.login_max_failures):
        res = _change(client, a, r, "wrong-old", "abcd1234")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "WRONG_PASSWORD"
    assert redis_client.ttl(_fail_key(settings)) > settings.login_lock_seconds - 5
    res = _change(client, a, r, "wrong-old", "abcd1234")
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_correct_old_password_also_locked(client, settings):
    t = login(client).json()
    a, r = t["access_token"], t["refresh_token"]
    for _ in range(settings.login_max_failures):
        _change(client, a, r, "wrong-old", "abcd1234")
    res = _change(client, a, r, "dev123", "abcd1234")
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_successful_change_clears_failure_count(client, settings, redis_client):
    t = login(client).json()
    a, r = t["access_token"], t["refresh_token"]
    for _ in range(settings.login_max_failures - 1):
        _change(client, a, r, "wrong-old", "abcd1234")
    assert redis_client.get(_fail_key(settings)) is not None
    assert _change(client, a, r, "dev123", "abcd1234").status_code == 200
    assert redis_client.get(_fail_key(settings)) is None


def test_login_lock_blocks_change_password(client, settings):
    t = login(client).json()
    for _ in range(settings.login_max_failures):
        login(client, pw="wrong")
    res = _change(client, t["access_token"], t["refresh_token"], "dev123", "abcd1234")
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_locked_change_password_has_retry_after(client, settings):
    t = login(client).json()
    a, r = t["access_token"], t["refresh_token"]
    for _ in range(settings.login_max_failures):
        _change(client, a, r, "wrong-old", "abcd1234")
    res = _change(client, a, r, "wrong-old", "abcd1234")
    assert res.status_code == 429
    assert 1 <= int(res.headers["Retry-After"]) <= settings.login_lock_seconds
