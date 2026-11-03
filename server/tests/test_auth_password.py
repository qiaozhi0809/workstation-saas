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
    for bad, reason in [
        ("12345678", "one_kind"),
        ("!!!!!!!!", "one_kind"),
        ("short1", "too_short"),
    ]:
        try:
            check_policy(bad)
        except ApiError as exc:
            assert exc.details["reason"] == reason
        else:
            raise AssertionError(bad)
    try:
        check_policy("a1" * 37)
    except ApiError as exc:
        assert exc.code == "PASSWORD_WEAK"
    else:
        raise AssertionError("over 72 bytes accepted")


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
