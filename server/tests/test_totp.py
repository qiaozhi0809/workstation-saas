import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pyotp
import pytest
from sqlalchemy import delete, select

from app import clock
from app.auth import mfa, service, totp
from app.crypto import CryptoError, decrypt, encrypt
from app.domain.school_settings.schemas import SecuritySettings
from app.domain.school_settings.service import SECURITY_KEY, save_security
from app.models import School, SchoolSetting, User
from app.models.audit import AuditLog
from app.rbac.roles import Role
from tests.factories import make_admin, make_teacher_account, make_user
from tests.helpers import audit_rows, auth
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

IT_ADMIN = "55555555-5555-5555-5555-555555555546"
DEAN = "55555555-5555-5555-5555-555555555544"
HOMEROOM = "55555555-5555-5555-5555-555555555541"  # teacher04,班主任
API = "/api/v1"


def _login(client, name="teacher01", pw="dev123"):
    return client.post(f"{API}/auth/login", json={"login_name": name, "password": pw})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _allow(db, allowed=True):
    save_security(
        db,
        UUID(SCHOOL_ID),
        SecuritySettings(totp_allowed=allowed, password_min_length=8, password_max_age_days=0),
        UUID(IT_ADMIN),
    )


def _turn_on(db, settings, user_id=TEACHER_USER_ID) -> str:
    """直接在库里给账号开启两步验证,返回明文 secret(测试现生成,不写死)。"""
    secret = pyotp.random_base32()
    user = db.get(User, UUID(user_id))
    user.totp_secret = encrypt(secret, settings.master_key_bytes, aad=f"totp:{user.id}")
    user.totp_enabled_at = clock.utc_now()
    db.flush()
    return secret


def _second_step(client, token, code):
    return client.post(f"{API}/auth/login/totp", json={"mfa_token": token, "code": code})


def _wrong_code(secret):
    good = {
        pyotp.TOTP(secret).at(datetime.now() + timedelta(seconds=d)) for d in (-60, -30, 0, 30, 60)
    }
    return next(c for c in (f"{n:06d}" for n in range(100000, 100100)) if c not in good)


# ---------- totp.verify ----------


def test_totp_window(redis_client):
    secret = pyotp.random_base32()
    t0 = datetime(2026, 11, 5, 8, 0, 10)
    gen = pyotp.TOTP(secret)
    code = gen.at(t0)
    assert totp.verify(redis_client, uuid4(), secret, code, t0)
    assert totp.verify(redis_client, uuid4(), secret, code, t0 + timedelta(seconds=30))
    assert totp.verify(redis_client, uuid4(), secret, code, t0 - timedelta(seconds=30))
    assert not totp.verify(redis_client, uuid4(), secret, code, t0 + timedelta(seconds=60))
    assert not totp.verify(redis_client, uuid4(), secret, code, t0 - timedelta(seconds=60))


def test_code_reuse_rejected(redis_client):
    secret = pyotp.random_base32()
    uid = uuid4()
    t0 = datetime(2026, 11, 5, 8, 0, 10)
    code = pyotp.TOTP(secret).at(t0)
    assert totp.verify(redis_client, uid, secret, code, t0)
    assert not totp.verify(redis_client, uid, secret, code, t0)
    # 同一步长换个时间点也算同一个码
    assert not totp.verify(redis_client, uid, secret, code, t0 + timedelta(seconds=5))
    # 别的账号不受影响
    assert totp.verify(redis_client, uuid4(), secret, code, t0)
    keys = redis_client.keys(f"ws:totp:used:{uid}:*")
    assert len(keys) == 1
    assert 0 < redis_client.ttl(keys[0]) <= 90


@pytest.mark.parametrize(
    "bad", ["", "12345", "1234567", "12345a", "１２３４５６", " 12345", "+12345"]
)
def test_non_six_digit_code_rejected(redis_client, bad):
    secret = pyotp.random_base32()
    assert not totp.verify(redis_client, uuid4(), secret, bad, datetime(2026, 11, 5, 8, 0, 10))


def test_rfc6238_vector(redis_client):
    # RFC 6238 附录 B 的 SHA1 测试向量:秘钥 ASCII "12345678901234567890",T=59 → 94287082(取后 6 位)
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.verify(redis_client, uuid4(), secret, "287082", datetime.fromtimestamp(59))


def test_provisioning_svg_and_uri():
    secret = pyotp.random_base32()
    uri, svg = totp.provisioning(secret, issuer="示例小学", account="teacher01")
    assert uri.startswith("otpauth://totp/")
    assert f"secret={secret}" in uri
    assert "issuer=" in uri
    assert svg.startswith("<svg")
    assert "<?xml" not in svg
    assert svg.count("<svg") == 1 and "\n" not in svg


# ---------- mfa 挑战 ----------


def test_mfa_token_single_use(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    body = _login(client).json()
    token = body["mfa_token"]
    code = pyotp.TOTP(secret).now()
    first = _second_step(client, token, code)
    assert first.status_code == 200
    # 同一个 token 再来一次(哪怕换一个新的有效码)也不行
    again = _second_step(
        client, token, pyotp.TOTP(secret).at(datetime.now() + timedelta(seconds=30))
    )
    assert again.status_code == 401
    assert again.json()["error"]["code"] == "MFA_EXPIRED"
    assert redis_client.get(f"ws:mfa:{token}") is None


def test_mfa_unknown_or_expired_token(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    assert 0 < redis_client.ttl(f"ws:mfa:{token}") <= 300
    redis_client.delete(f"ws:mfa:{token}")
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert (res.status_code, res.json()["error"]["code"]) == (401, "MFA_EXPIRED")
    res = _second_step(client, "nonexistent-token", "123456")
    assert (res.status_code, res.json()["error"]["code"]) == (401, "MFA_EXPIRED")


def test_mfa_unit_semantics(redis_client):
    uid = uuid4()
    token = mfa.issue_challenge(redis_client, uid)
    assert json.loads(redis_client.get(f"ws:mfa:{token}")) == {"user_id": str(uid), "tries": 0}
    assert redis_client.ttl(f"ws:mfa:{token}") <= 300
    assert [mfa.record_try(redis_client, token) for _ in range(4)] == [1, 2, 3, 4]
    assert mfa.record_try(redis_client, token) == 5
    assert redis_client.get(f"ws:mfa:{token}") is None
    assert mfa.consume(redis_client, token) is None
    token2 = mfa.issue_challenge(redis_client, uid)
    assert mfa.consume(redis_client, token2) == uid
    assert mfa.consume(redis_client, token2) is None
    assert mfa.record_try(redis_client, token2) == 0


# ---------- 登录 ----------


def test_login_with_totp_returns_no_tokens(client, db, settings, redis_client):
    _turn_on(db, settings)
    db.get(User, UUID(TEACHER_USER_ID)).last_login_at = None
    db.flush()
    res = _login(client)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"mfa_required", "mfa_token", "expires_in"}
    assert body["mfa_required"] is True and body["expires_in"] == 300
    assert redis_client.smembers(f"ws:user_refresh:{TEACHER_USER_ID}") == set()
    assert redis_client.keys("ws:refresh:*") == []
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).last_login_at is None


def test_second_step_issues_tokens(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["display_name"] == "张老师"
    me = client.get(f"{API}/auth/me", headers=_bearer(body["access_token"]))
    assert me.status_code == 200
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).last_login_at is not None
    assert len(redis_client.smembers(f"ws:user_refresh:{TEACHER_USER_ID}")) == 1


def test_wrong_code_message_and_same_code_reuse(client, db, settings):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    res = _second_step(client, token, _wrong_code(secret))
    assert res.status_code == 401
    err = res.json()["error"]
    assert err["code"] == "TOTP_INVALID"
    assert "验证码不正确或已过期,请检查手机时间" in err["message"]
    code = pyotp.TOTP(secret).now()
    assert _second_step(client, token, code).status_code == 200
    # 已用过的码,换新 token 也不能再用
    token2 = _login(client).json()["mfa_token"]
    res = _second_step(client, token2, code)
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOTP_INVALID")


def test_totp_bruteforce_locks(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    token_a = _login(client).json()["mfa_token"]
    token_b = _login(client).json()["mfa_token"]
    wrong = _wrong_code(secret)
    for _ in range(5):
        res = _second_step(client, token_a, wrong)
        assert (res.status_code, res.json()["error"]["code"]) == (401, "TOTP_INVALID")
    # token_a 已作废;token_b 对应的登录名已被锁
    res = _second_step(client, token_b, pyotp.TOTP(secret).now())
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "ACCOUNT_LOCKED"
    assert int(res.headers["Retry-After"]) > 0
    # 第一步也被拒(登录名锁定),不再签发新的 mfa_token
    assert _login(client).status_code == 429
    assert redis_client.get(f"ws:mfa:{token_a}") is None


def test_totp_failure_counted_before_verify(client, db, settings, redis_client, monkeypatch):
    """L142:先原子 INCR 再验证——校验验证码时计数已含本次;达到上限的请求不再验证,
    并发多个 mfa_token 也放大不了单个锁定窗口里的猜码次数。"""
    secret = _turn_on(db, settings)
    key = service._fail_key(settings, "teacher01")
    seen: list[int] = []
    real_verify = totp.verify

    def spy(redis, uid, sec, code, now):
        seen.append(int(redis.get(key) or 0))
        return real_verify(redis, uid, sec, code, now)

    monkeypatch.setattr(totp, "verify", spy)
    tokens = [_login(client).json()["mfa_token"] for _ in range(3)]
    wrong = _wrong_code(secret)
    for n, tok in enumerate(tokens, start=1):
        assert _second_step(client, tok, wrong).status_code == 401
        assert int(redis_client.get(key)) == n
    assert seen == [1, 2, 3]  # 每次校验时计数已经包含本次
    for _ in range(2):
        assert _second_step(client, tokens[0], wrong).status_code == 401
    assert int(redis_client.get(key)) == settings.login_max_failures and len(seen) == 5
    # 第 6 个请求(换一个 token、拿着正确的码)直接 429,根本不进入验证,正确码也没被消耗
    res = _second_step(client, tokens[1], pyotp.TOTP(secret).now())
    assert (res.status_code, res.json()["error"]["code"]) == (429, "ACCOUNT_LOCKED")
    assert int(res.headers["Retry-After"]) > 0
    assert len(seen) == 5 and redis_client.keys("ws:totp:used:*") == []


def test_token_dies_after_five_tries_even_below_lock(client, db, settings, redis_client):
    settings.login_max_failures = 50
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    wrong = _wrong_code(secret)
    for _ in range(5):
        assert _second_step(client, token, wrong).status_code == 401
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert (res.status_code, res.json()["error"]["code"]) == (401, "MFA_EXPIRED")


def test_password_step_does_not_reset_failure_counter(client, db, settings, redis_client):
    """防止"每次试 4 个码再用密码重置计数"的绕过。"""
    secret = _turn_on(db, settings)
    key = service._fail_key(settings, "teacher01")
    token = _login(client).json()["mfa_token"]
    for _ in range(2):
        _second_step(client, token, _wrong_code(secret))
    assert int(redis_client.get(key)) == 2
    _login(client)
    assert int(redis_client.get(key)) == 2
    token = _login(client).json()["mfa_token"]
    assert _second_step(client, token, pyotp.TOTP(secret).now()).status_code == 200
    assert redis_client.get(key) is None


def test_frozen_before_second_step_rejected(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    db.get(User, UUID(TEACHER_USER_ID)).status = "frozen"
    db.flush()
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert res.status_code == 401
    assert redis_client.keys("ws:refresh:*") == []
    assert redis_client.get(f"ws:mfa:{token}") is None


def test_totp_reset_between_steps_rejected(client, db, settings):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    user = db.get(User, UUID(TEACHER_USER_ID))
    user.totp_secret = None
    user.totp_enabled_at = None
    db.flush()
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert (res.status_code, res.json()["error"]["code"]) == (401, "MFA_EXPIRED")


def test_must_change_password_still_enforced_after_second_step(client, db, settings):
    secret = _turn_on(db, settings)
    db.get(User, UUID(TEACHER_USER_ID)).must_change_password = True
    db.flush()
    token = _login(client).json()["mfa_token"]
    res = _second_step(client, token, pyotp.TOTP(secret).now())
    assert res.status_code == 200
    assert res.json()["user"]["must_change_password"] is True
    h = _bearer(res.json()["access_token"])
    biz = client.get(f"{API}/auth/totp", headers=h)  # 业务接口走 get_current_user
    assert biz.status_code == 403
    assert biz.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"


# ---------- 自助开启 / 关闭 ----------


def _setup_and_enable(client, headers, refresh_token):
    setup = client.post(f"{API}/auth/totp/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=headers,
        json={
            "code": pyotp.TOTP(secret).now(),
            "password": "dev123",
            "refresh_token": refresh_token,
        },
    )
    return setup.json(), res


def test_setup_returns_secret_once_and_status(client, db, settings, redis_client):
    _allow(db)
    login = _login(client).json()
    h = _bearer(login["access_token"])
    st = client.get(f"{API}/auth/totp", headers=h).json()
    assert st == {"allowed": True, "enabled": False, "enabled_at": None}
    body = client.post(f"{API}/auth/totp/setup", headers=h).json()
    assert set(body) == {"secret", "otpauth_uri", "qr_svg"}
    assert body["qr_svg"].startswith("<svg")
    assert body["secret"] in body["otpauth_uri"]
    # 没确认前库里没有 secret
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_secret is None
    assert 0 < redis_client.ttl(f"ws:totp:pending:{TEACHER_USER_ID}") <= 600


def test_enable_wrong_code_or_without_setup(client, db, settings):
    _allow(db)
    login = _login(client).json()
    h = _bearer(login["access_token"])
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={"code": "123456", "password": "dev123", "refresh_token": login["refresh_token"]},
    )
    assert (res.status_code, res.json()["error"]["code"]) == (409, "TOTP_SETUP_EXPIRED")
    secret = client.post(f"{API}/auth/totp/setup", headers=h).json()["secret"]
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={
            "code": _wrong_code(secret),
            "password": "dev123",
            "refresh_token": login["refresh_token"],
        },
    )
    assert (res.status_code, res.json()["error"]["code"]) == (400, "TOTP_INVALID")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None


def test_enable_totp_revokes_other_sessions(client, db, settings, redis_client):
    _allow(db)
    s1 = _login(client).json()
    s2 = _login(client).json()
    h2 = _bearer(s2["access_token"])
    _, res = _setup_and_enable(client, h2, s2["refresh_token"])
    assert res.status_code == 200 and res.json() == {"enabled": True}
    r1 = client.post(f"{API}/auth/refresh", json={"refresh_token": s1["refresh_token"]})
    assert (r1.status_code, r1.json()["error"]["code"]) == (401, "INVALID_REFRESH")
    r2 = client.post(f"{API}/auth/refresh", json={"refresh_token": s2["refresh_token"]})
    assert r2.status_code == 200
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is not None
    row = audit_rows(db, TEACHER_USER_ID)
    enabled = [r for r in row if r.action == "account.totp_enable"]
    assert len(enabled) == 1 and enabled[0].extra is None
    # 已开启后再 setup / 再 login 都按两步走(旧令牌可能因跨整秒被拒,用刷新出的新令牌)
    h2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    assert client.post(f"{API}/auth/totp/setup", headers=h2).status_code == 409
    assert _login(client).json()["mfa_required"] is True


def test_enable_totp_publishes_stale(client, db, settings, redis_client):
    _allow(db)
    s = _login(client).json()
    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    _, res = _setup_and_enable(client, _bearer(s["access_token"]), s["refresh_token"])
    assert res.status_code == 200
    got = []
    while (msg := pubsub.get_message(timeout=0.5)) is not None:
        if msg["type"] == "message":
            got.append(json.loads(msg["data"]))
    pubsub.close()
    assert got == [{"user_ids": [TEACHER_USER_ID], "event": {"type": "session.stale"}}]


def test_enable_wrong_password_publishes_nothing(client, db, settings, redis_client):
    _allow(db)
    s = _login(client).json()
    h = _bearer(s["access_token"])
    assert client.post(f"{API}/auth/totp/setup", headers=h).status_code == 200
    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={"code": "000000", "password": "wrong-pass-1", "refresh_token": s["refresh_token"]},
    )
    assert res.status_code == 400
    assert [
        m for m in iter(lambda: pubsub.get_message(timeout=0.5), None) if m["type"] == "message"
    ] == []
    pubsub.close()


def test_secret_stored_encrypted(client, db, settings):
    _allow(db)
    s = _login(client).json()
    body, res = _setup_and_enable(client, _bearer(s["access_token"]), s["refresh_token"])
    assert res.status_code == 200
    db.expire_all()
    stored = db.get(User, UUID(TEACHER_USER_ID)).totp_secret
    assert stored.startswith("v2:")
    assert stored != body["secret"] and body["secret"] not in stored
    key = settings.master_key_bytes
    assert decrypt(stored, key, aad=f"totp:{TEACHER_USER_ID}") == body["secret"]
    with pytest.raises(CryptoError):
        decrypt(stored, key, aad=f"totp:{uuid4()}")


def test_setup_blocked_when_not_allowed(client, db, settings):
    # 空库:没有 security 设置行 → 默认不允许
    db.execute(delete(SchoolSetting).where(SchoolSetting.key == SECURITY_KEY))
    db.flush()
    s = _login(client).json()
    h = _bearer(s["access_token"])
    assert client.get(f"{API}/auth/totp", headers=h).json()["allowed"] is False
    res = client.post(f"{API}/auth/totp/setup", headers=h)
    assert (res.status_code, res.json()["error"]["code"]) == (409, "TOTP_NOT_ALLOWED")


def test_disable_requires_password(client, db, settings, redis_client):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    s = _second_step(client, token, pyotp.TOTP(secret).now()).json()
    h = _bearer(s["access_token"])
    bad = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "wrong"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "WRONG_PASSWORD")
    assert int(redis_client.get(service._fail_key(settings, "teacher01"))) == 1
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is not None
    ok = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "dev123"})
    assert ok.status_code == 200 and ok.json() == {"enabled": False}
    db.expire_all()
    user = db.get(User, UUID(TEACHER_USER_ID))
    assert user.totp_secret is None and user.totp_enabled_at is None
    assert any(r.action == "account.totp_disable" for r in audit_rows(db, TEACHER_USER_ID))
    assert "access_token" in _login(client).json()


def test_disable_password_attempts_locked(client, db, settings):
    secret = _turn_on(db, settings)
    token = _login(client).json()["mfa_token"]
    s = _second_step(client, token, pyotp.TOTP(secret).now()).json()
    h = _bearer(s["access_token"])
    for _ in range(5):
        client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "wrong"})
    res = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "dev123"})
    assert res.status_code == 429 and "Retry-After" in res.headers


def test_disable_when_not_enabled_is_noop_ok(client, db, settings):
    s = _login(client).json()
    res = client.post(
        f"{API}/auth/totp/disable", headers=_bearer(s["access_token"]), json={"password": "dev123"}
    )
    assert res.status_code == 200 and res.json() == {"enabled": False}


def test_switch_off_keeps_enabled_users(client, db, settings):
    secret = _turn_on(db, settings)
    _allow(db, False)
    # 已开启的人仍要求验证码
    res = _login(client)
    assert res.json()["mfa_required"] is True
    ok = _second_step(client, res.json()["mfa_token"], pyotp.TOTP(secret).now())
    assert ok.status_code == 200
    h = _bearer(ok.json()["access_token"])
    st = client.get(f"{API}/auth/totp", headers=h).json()
    assert st["allowed"] is False and st["enabled"] is True
    # 新的人不能再开启
    other = _login(client, "teacher04").json()
    setup = client.post(f"{API}/auth/totp/setup", headers=_bearer(other["access_token"]))
    assert (setup.status_code, setup.json()["error"]["code"]) == (409, "TOTP_NOT_ALLOWED")
    # 已开启的人仍可关闭
    off = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "dev123"})
    assert off.status_code == 200


def test_enable_rejected_when_switched_off_after_setup(client, db, settings):
    _allow(db)
    s = _login(client).json()
    h = _bearer(s["access_token"])
    secret = client.post(f"{API}/auth/totp/setup", headers=h).json()["secret"]
    _allow(db, False)
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={
            "code": pyotp.TOTP(secret).now(),
            "password": "dev123",
            "refresh_token": s["refresh_token"],
        },
    )
    assert (res.status_code, res.json()["error"]["code"]) == (409, "TOTP_NOT_ALLOWED")


def test_self_endpoints_require_login(client):
    assert client.get(f"{API}/auth/totp").status_code == 401
    assert client.post(f"{API}/auth/totp/setup").status_code == 401
    enable = client.post(
        f"{API}/auth/totp/enable",
        json={"code": "123456", "password": "dev123", "refresh_token": "x"},
    )
    assert enable.status_code == 401
    assert client.post(f"{API}/auth/totp/disable", json={"password": "x"}).status_code == 401


# ---------- 管理端重置 ----------


def _reset(client, settings, actor, target):
    return client.post(f"{API}/admin/accounts/{target}/totp-reset", headers=auth(settings, actor))


def test_totp_reset_requires_account_manage(client, db, settings):
    secret = _turn_on(db, settings)
    assert secret
    # 无权限的人:403 FORBIDDEN(不是 404 也不是 200,也不是被改密码拦成别的码)
    grade_head = make_admin(db, None, Role.grade_head.value)
    for actor in (TEACHER_USER_ID, HOMEROOM, DEAN, grade_head.id):
        assert db.get(User, UUID(str(actor))).must_change_password is False
        res = _reset(client, settings, actor, TEACHER_USER_ID)
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is not None
    # 信息中心 200
    res = _reset(client, settings, IT_ADMIN, TEACHER_USER_ID)
    assert res.status_code == 200 and res.json() == {"ok": True}
    db.expire_all()
    user = db.get(User, UUID(TEACHER_USER_ID))
    assert user.totp_secret is None and user.totp_enabled_at is None
    rows = [r for r in audit_rows(db, TEACHER_USER_ID) if r.action == "account.totp_reset"]
    assert len(rows) == 1 and rows[0].user_id == UUID(IT_ADMIN) and rows[0].extra is None
    # 之后登录不再要两步
    assert "access_token" in _login(client).json()
    # 对自己 409
    me = _reset(client, settings, IT_ADMIN, IT_ADMIN)
    assert (me.status_code, me.json()["error"]["code"]) == (409, "CANNOT_RESET_SELF")


def test_totp_reset_unauthenticated_and_scope(client, db, settings):
    assert client.post(f"{API}/admin/accounts/{TEACHER_USER_ID}/totp-reset").status_code == 401
    assert _reset(client, settings, IT_ADMIN, uuid4()).status_code == 404
    other = School(name="别校")
    db.add(other)
    db.flush()
    stranger = make_teacher_account(db, other.id)
    stranger.totp_enabled_at = clock.utc_now()
    stranger.totp_secret = "v2:x"
    db.flush()
    assert _reset(client, settings, IT_ADMIN, stranger.id).status_code == 404
    db.expire_all()
    assert db.get(User, stranger.id).totp_enabled_at is not None


def _token_at(settings, when: datetime) -> str:
    """按指定 iat 签发 teacher01 的令牌(exp 仍在未来)。"""
    import jwt

    return jwt.encode(
        {"sub": TEACHER_USER_ID, "iat": when, "exp": clock.utc_now() + timedelta(seconds=600)},
        settings.jwt_secret,
        algorithm="HS256",
    )


def _me(client, token):
    return client.get(f"{API}/auth/me", headers=_bearer(token))


def test_token_floor_after_totp_reset(client, db, settings):
    """L144:开启两步验证之前签发的令牌,在关闭 / 管理员重置两步验证之后仍然 401(不复活);
    只写 token_floor_at,不动 password_changed_at。"""
    user = db.get(User, UUID(TEACHER_USER_ID))
    user.password_changed_at = clock.utc_now() - timedelta(hours=1)
    db.flush()
    pw_changed = user.password_changed_at

    # 自助关闭
    before = _token_at(settings, clock.utc_now() - timedelta(minutes=30))
    assert _me(client, before).status_code == 200
    secret = _turn_on(db, settings)
    assert _me(client, before).status_code == 401
    token = _login(client).json()["mfa_token"]
    s = _second_step(client, token, pyotp.TOTP(secret).now()).json()
    off = client.post(
        f"{API}/auth/totp/disable", headers=_bearer(s["access_token"]), json={"password": "dev123"}
    )
    assert off.status_code == 200
    db.expire_all()
    user = db.get(User, UUID(TEACHER_USER_ID))
    assert user.totp_enabled_at is None and user.token_floor_at is not None
    assert user.password_changed_at == pw_changed
    res = _me(client, before)
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")
    fresh = _login(client).json()
    assert _me(client, fresh["access_token"]).status_code == 200

    # 管理员重置:先清掉上面留下的下限,再走一遍
    user.token_floor_at = None
    db.flush()
    before = _token_at(settings, clock.utc_now() - timedelta(minutes=30))
    assert _me(client, before).status_code == 200
    _turn_on(db, settings)
    assert _me(client, before).status_code == 401
    assert _reset(client, settings, IT_ADMIN, TEACHER_USER_ID).status_code == 200
    db.expire_all()
    user = db.get(User, UUID(TEACHER_USER_ID))
    assert user.totp_enabled_at is None and user.token_floor_at is not None
    assert user.password_changed_at == pw_changed
    res = _me(client, before)
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")
    fresh = _login(client).json()
    assert "access_token" in fresh and _me(client, fresh["access_token"]).status_code == 200


def test_totp_reset_on_user_without_totp_does_not_set_floor(client, db, settings):
    """审查第 1 轮:对从未开启两步验证的人重置,不该写 token_floor_at(不踢他的会话)。"""
    plain = make_user(db, "no_totp_x", "无两步")
    assert plain.totp_enabled_at is None and plain.token_floor_at is None
    assert _reset(client, settings, IT_ADMIN, plain.id).status_code == 200
    db.expire_all()
    plain = db.get(User, plain.id)
    assert plain.totp_secret is None and plain.totp_enabled_at is None
    assert plain.token_floor_at is None
    # 审计照记,只是不动令牌下限
    assert [r.action for r in audit_rows(db, plain.id)] == ["account.totp_reset"]


def test_totp_reset_works_for_parent_only_account(client, db, settings):
    parent = make_user(db, "parent_only_x", "家长")
    parent.totp_enabled_at = clock.utc_now()
    parent.totp_secret = "v2:x"
    db.flush()
    assert _reset(client, settings, IT_ADMIN, parent.id).status_code == 200
    db.expire_all()
    assert db.get(User, parent.id).totp_secret is None


def test_no_secret_or_code_in_audit(client, db, settings):
    _allow(db)
    s = _login(client).json()
    body, _ = _setup_and_enable(client, _bearer(s["access_token"]), s["refresh_token"])
    dump = json.dumps(
        [(r.action, r.object_id, r.extra) for r in db.scalars(select(AuditLog)).all()],
        default=str,
    )
    assert body["secret"] not in dump


# ---------- K1/K2:开启需要密码,错误码钉死 ----------


def _enable(client, h, refresh, code, password="dev123"):
    return client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={"code": code, "password": password, "refresh_token": refresh},
    )


def _err(res):
    return res.status_code, res.json()["error"]["code"]


def _fail_key(settings):
    return service._fail_key(settings, "teacher01")


def _pending_session(client, db):
    _allow(db)
    s = _login(client).json()
    h = _bearer(s["access_token"])
    secret = client.post(f"{API}/auth/totp/setup", headers=h).json()["secret"]
    return s, h, secret


def test_enable_requires_password(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    other = _login(client).json()
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now(), password="wrong")
    assert _err(res) == (400, "WRONG_PASSWORD")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": other["refresh_token"]})
    assert r.status_code == 200
    assert int(redis_client.get(_fail_key(settings))) == 1


def test_enable_wrong_password_counts_failures(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    code = pyotp.TOTP(secret).now()
    for _ in range(settings.login_max_failures - 1):
        res = _enable(client, h, s["refresh_token"], code, password="wrong")
        assert _err(res) == (400, "WRONG_PASSWORD")
    res = _enable(client, h, s["refresh_token"], code, password="wrong")
    assert _err(res) == (400, "WRONG_PASSWORD")
    assert int(redis_client.get(_fail_key(settings))) == settings.login_max_failures
    res = _enable(client, h, s["refresh_token"], code, password="wrong")
    assert _err(res) == (429, "ACCOUNT_LOCKED") and "Retry-After" in res.headers
    res = _enable(client, h, s["refresh_token"], code)
    assert _err(res) == (429, "ACCOUNT_LOCKED") and "Retry-After" in res.headers
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None


def test_enable_right_password_wrong_code(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    res = _enable(client, h, s["refresh_token"], _wrong_code(secret))
    assert _err(res) == (400, "TOTP_INVALID")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None
    assert redis_client.get(_fail_key(settings)) is None  # 码错不计入密码失败次数


def test_enable_locked_checks_neither_password_nor_code(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    redis_client.set(_fail_key(settings), settings.login_max_failures, ex=60)
    for pw, code in (("dev123", pyotp.TOTP(secret).now()), ("wrong", "000000")):
        res = _enable(client, h, s["refresh_token"], code, password=pw)
        assert _err(res) == (429, "ACCOUNT_LOCKED") and "Retry-After" in res.headers
    # 被锁时没有再计数,待确认的 secret 也没被消耗
    assert int(redis_client.get(_fail_key(settings))) == settings.login_max_failures
    raw = redis_client.get(f"ws:totp:pending:{TEACHER_USER_ID}")
    assert decrypt(raw, settings.master_key_bytes, aad=f"totp-pending:{TEACHER_USER_ID}") == secret


def test_pending_secret_encrypted_in_redis(client, db, settings, redis_client):
    """L143:待确认的 secret 在 Redis 里是绑定用户的密文,原文里没有 base32 secret。"""
    s, h, secret = _pending_session(client, db)
    raw = redis_client.get(f"ws:totp:pending:{TEACHER_USER_ID}")
    assert raw.startswith("v2:") and secret not in raw
    assert 0 < redis_client.ttl(f"ws:totp:pending:{TEACHER_USER_ID}") <= 600
    key = settings.master_key_bytes
    assert decrypt(raw, key, aad=f"totp-pending:{TEACHER_USER_ID}") == secret
    with pytest.raises(CryptoError):  # 不能被挪去冒充正式 secret 的密文
        decrypt(raw, key, aad=f"totp:{TEACHER_USER_ID}")
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now())
    assert res.status_code == 200
    db.expire_all()
    stored = db.get(User, UUID(TEACHER_USER_ID)).totp_secret
    assert decrypt(stored, key, aad=f"totp:{TEACHER_USER_ID}") == secret


def test_pending_secret_unreadable_is_setup_expired(client, db, settings, redis_client):
    """待确认值解不开(主密钥换过 / 被篡改)→ 409 设置已过期,重新开始即可;不开启、不 500。"""
    s, h, secret = _pending_session(client, db)
    redis_client.set(f"ws:totp:pending:{TEACHER_USER_ID}", "v2:bm90LXJlYWwtY2lwaGVydGV4dA==", ex=60)
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now())
    assert _err(res) == (409, "TOTP_SETUP_EXPIRED")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None


def test_enable_success_clears_failures(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now(), password="wrong")
    assert redis_client.get(_fail_key(settings)) is not None
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now())
    assert res.status_code == 200
    assert redis_client.get(_fail_key(settings)) is None


@pytest.mark.parametrize("bad", ["", "12345", "1234567", "abcdef"])
def test_password_cannot_replace_code(client, db, settings, bad):
    s, h, secret = _pending_session(client, db)
    res = _enable(client, h, s["refresh_token"], bad)
    assert res.status_code == 400
    assert res.json()["error"]["code"] in ("BAD_REQUEST", "TOTP_INVALID")
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None


def test_enable_missing_password_field_rejected(client, db, settings):
    s, h, secret = _pending_session(client, db)
    res = client.post(
        f"{API}/auth/totp/enable",
        headers=h,
        json={"code": pyotp.TOTP(secret).now(), "refresh_token": s["refresh_token"]},
    )
    assert res.status_code == 400
    db.expire_all()
    assert db.get(User, UUID(TEACHER_USER_ID)).totp_enabled_at is None


def test_enable_setup_expired_409(client, db, settings, redis_client):
    s, h, secret = _pending_session(client, db)
    redis_client.delete(f"ws:totp:pending:{TEACHER_USER_ID}")
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now())
    assert _err(res) == (409, "TOTP_SETUP_EXPIRED")


def test_enable_not_allowed_409(client, db, settings):
    s, h, secret = _pending_session(client, db)
    _allow(db, False)
    res = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now())
    assert _err(res) == (409, "TOTP_NOT_ALLOWED")


def test_logged_in_errors_never_401(client, db, settings, redis_client):
    """已登录接口的业务错误不得是 401,否则前端会刷新重发导致错误被计两次。"""
    s, h, secret = _pending_session(client, db)
    wrong_pw = _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now(), password="wrong")
    wrong_code = _enable(client, h, s["refresh_token"], _wrong_code(secret))
    assert (wrong_pw.status_code, wrong_code.status_code) == (400, 400)
    dis = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "wrong"})
    assert _err(dis) == (400, "WRONG_PASSWORD")
    assert int(redis_client.get(_fail_key(settings))) == 2  # 密码错各计一次,没有重复计数


def test_enable_then_disable_lock_shared(client, db, settings, redis_client):
    """enable 与 disable 共用同一个失败计数,disable 达上限同样 429。"""
    s, h, secret = _pending_session(client, db)
    for _ in range(settings.login_max_failures):
        _enable(client, h, s["refresh_token"], pyotp.TOTP(secret).now(), password="wrong")
    res = client.post(f"{API}/auth/totp/disable", headers=h, json={"password": "dev123"})
    assert _err(res) == (429, "ACCOUNT_LOCKED") and "Retry-After" in res.headers


def _plant_secret(db, cipher):
    user = db.get(User, UUID(TEACHER_USER_ID))
    user.totp_secret = cipher
    user.totp_enabled_at = clock.utc_now()
    db.flush()


def test_legacy_unprefixed_secret_unreadable(client, db, settings):
    import base64
    import os

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    ct = AESGCM(settings.master_key_bytes).encrypt(nonce, pyotp.random_base32().encode(), None)
    _plant_secret(db, base64.b64encode(nonce + ct).decode())
    token = _login(client).json()["mfa_token"]
    res = _second_step(client, token, "123456")
    assert (res.status_code, res.json()["error"]["code"]) == (500, "TOTP_UNREADABLE")


def test_non_base32_secret_unreadable(client, db, settings):
    _plant_secret(
        db, encrypt("not base32 !!", settings.master_key_bytes, aad=f"totp:{TEACHER_USER_ID}")
    )
    token = _login(client).json()["mfa_token"]
    res = _second_step(client, token, "123456")
    assert (res.status_code, res.json()["error"]["code"]) == (500, "TOTP_UNREADABLE")
