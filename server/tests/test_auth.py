import json
import warnings
from datetime import datetime, timedelta
from uuid import UUID

import jwt
from jwt.warnings import InsecureKeyLengthWarning
from sqlalchemy import func, select

from app import clock
from app.auth import sessions
from app.auth.tokens import decode_access_token, issue_access_token
from app.domain.school_settings.schemas import SecuritySettings
from app.domain.school_settings.service import save_security
from app.models import User
from app.rbac.roles import Role
from tests.factories import bind
from tests.helpers import auth, freeze
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


def test_unknown_and_frozen_user_still_verify(client, db, monkeypatch):
    import app.auth.service as svc

    calls = []
    real = svc.verify_password

    def spy(plain, hashed):
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(svc, "verify_password", spy)
    assert login(client, name="nobody", pw="x").status_code == 401
    assert len(calls) == 1
    assert calls[0] == svc._DUMMY_HASH
    calls.clear()
    db.query(User).filter(User.login_name == "teacher01").update({"status": "frozen"})
    db.flush()
    res = login(client)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert len(calls) == 1
    calls.clear()
    db.query(User).filter(User.login_name == "teacher01").update({"status": "active"})
    db.flush()
    assert login(client, pw="wrong").status_code == 401
    assert len(calls) == 1


def test_locked_login_has_retry_after(client, settings):
    for _ in range(settings.login_max_failures):
        login(client, pw="wrong")
    res = login(client)
    assert res.status_code == 429
    assert 1 <= int(res.headers["Retry-After"]) <= settings.login_lock_seconds


def test_first_failure_sets_ttl_atomically(client, settings, redis_client, monkeypatch):
    settings.login_max_failures = 5  # M5b R11:不依赖默认值
    key = f"ws:login_fail:{SCHOOL_ID}:teacher01"
    flags = []
    real_pipeline = redis_client.pipeline

    def spy_pipeline(transaction=True, shard_hint=None):
        flags.append(transaction)
        return real_pipeline(transaction=transaction, shard_hint=shard_hint)

    def forbidden(*_a, **_k):
        raise AssertionError("incr/expire must run inside the transaction pipeline")

    monkeypatch.setattr(redis_client, "pipeline", spy_pipeline)
    monkeypatch.setattr(redis_client, "incr", forbidden)
    monkeypatch.setattr(redis_client, "expire", forbidden)
    assert login(client, pw="wrong").status_code == 401
    assert flags == [True]
    assert 0 < redis_client.ttl(key) <= settings.login_lock_seconds


def test_nth_failure_resets_ttl(client, settings, redis_client):
    key = f"ws:login_fail:{SCHOOL_ID}:teacher01"
    for _ in range(settings.login_max_failures - 1):
        login(client, pw="wrong")
    redis_client.expire(key, 10)
    login(client, pw="wrong")
    assert redis_client.ttl(key) > settings.login_lock_seconds - 5


def _parent_ctx(client, name):
    return login(client, name).json()["user"]["contexts"]


def test_parent_context(client, db):
    from sqlalchemy import update

    from app.models import RoleBinding

    assert _parent_ctx(client, "13800000061") == ["parent"]
    assert _parent_ctx(client, "teacher04") == ["teacher", "parent"]
    token = login(client, "13800000061").json()["access_token"]
    me = client.get("/api/v1/auth/me", headers=bearer(token)).json()
    assert me["contexts"] == ["parent"]
    # 只读不改绑定,仍有 parent;绑定结束后没有
    uid = db.scalar(select(User.id).where(User.login_name == "13800000061"))
    db.execute(update(RoleBinding).where(RoleBinding.user_id == uid).values(ended_at=func.now()))
    db.flush()
    assert _parent_ctx(client, "13800000061") == []


# ---- M5b 段 A Task 3a:密码有效期 / 改密原因 / iat 判定 ----

API = "/api/v1"
UID = UUID(TEACHER_USER_ID)


def _set_security(db, max_age=0, min_length=8):
    save_security(
        db,
        UUID(SCHOOL_ID),
        SecuritySettings(
            totp_allowed=True, password_min_length=min_length, password_max_age_days=max_age
        ),
        UID,
    )


def _user(db) -> User:
    user = db.get(User, UID)
    db.refresh(user)
    return user


def _token_at(settings, user_id, when: datetime) -> str:
    """按指定 iat 签发的令牌(exp 仍在未来,用真实时钟校验)。"""
    return jwt.encode(
        {
            "sub": str(user_id),
            "iat": when,
            "exp": clock.utc_now() + timedelta(seconds=600),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def _enable_totp_row(user: User, at: datetime) -> None:
    user.totp_secret = "placeholder-not-decrypted"  # users_totp_pair_ck:两列须同时有值
    user.totp_enabled_at = at


def test_expiry_reason_priority(client, db):
    _set_security(db, max_age=90)
    user = _user(db)
    # 临时密码 / 首次:first_login 优先,即使同时已过期
    user.must_change_password = True
    user.password_changed_at = clock.utc_now() - timedelta(days=91)
    db.flush()
    brief = login(client).json()["user"]
    assert brief["password_change_reason"] == "first_login"
    assert brief["must_change_password"] is True
    # 仅过期
    user.must_change_password = False
    db.flush()
    brief = login(client).json()["user"]
    assert brief["password_change_reason"] == "expired"
    assert brief["must_change_password"] is True
    # 未满 90 天
    user.password_changed_at = clock.utc_now() - timedelta(days=89)
    db.flush()
    brief = login(client).json()["user"]
    assert brief["password_change_reason"] is None
    assert brief["must_change_password"] is False
    # 有效期关闭(0)则永不过期
    _set_security(db, max_age=0)
    user.password_changed_at = clock.utc_now() - timedelta(days=4000)
    db.flush()
    assert login(client).json()["user"]["password_change_reason"] is None


def test_expiry_cleared_after_password_change(client, db):
    _set_security(db, max_age=90)
    _user(db).password_changed_at = clock.utc_now() - timedelta(days=91)
    db.flush()
    t = login(client).json()
    assert t["user"]["password_change_reason"] == "expired"
    res = client.post(
        f"{API}/auth/password",
        headers=bearer(t["access_token"]),
        json={
            "old_password": "dev123",
            "new_password": "Brand-new-9x",
            "refresh_token": t["refresh_token"],
        },
    )
    assert res.status_code == 200
    again = login(client, pw="Brand-new-9x").json()
    assert again["user"]["password_change_reason"] is None
    assert again["user"]["must_change_password"] is False


def test_expired_password_blocks_business_api(client, db):
    _set_security(db, max_age=90)
    _user(db).password_changed_at = clock.utc_now() - timedelta(days=91)
    db.flush()
    h = bearer(login(client).json()["access_token"])
    blocked = client.get(f"{API}/me/classes", headers=h)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    me = client.get(f"{API}/auth/me", headers=h)
    assert me.status_code == 200
    assert me.json()["password_change_reason"] == "expired"
    assert me.json()["must_change_password"] is True
    assert client.get(f"{API}/auth/password-policy", headers=h).status_code == 200
    # 关掉有效期后恢复
    _set_security(db, max_age=0)
    assert client.get(f"{API}/me/classes", headers=h).status_code == 200


def test_change_password_publishes_stale(client, db, redis_client):
    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    t = login(client).json()
    res = client.post(
        f"{API}/auth/password",
        headers=bearer(t["access_token"]),
        json={
            "old_password": "dev123",
            "new_password": "Brand-new-9x",
            "refresh_token": t["refresh_token"],
        },
    )
    assert res.status_code == 200
    got = []
    while (msg := pubsub.get_message(timeout=0.5)) is not None:
        if msg["type"] == "message":
            got.append(json.loads(msg["data"]))
    pubsub.close()
    assert got == [{"user_ids": [TEACHER_USER_ID], "event": {"type": "session.stale"}}]


def test_wrong_old_password_publishes_nothing(client, redis_client):
    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    t = login(client).json()
    res = client.post(
        f"{API}/auth/password",
        headers=bearer(t["access_token"]),
        json={"old_password": "nope", "new_password": "Brand-new-9x", "refresh_token": "x"},
    )
    assert res.status_code == 400
    assert pubsub.get_message(timeout=0.5) is None
    pubsub.close()


def test_access_token_issued_before_password_change_rejected(client, db, settings):
    _user(db).password_changed_at = clock.utc_now() - timedelta(hours=1)
    db.flush()
    old = _token_at(settings, UID, clock.utc_now() - timedelta(seconds=30))
    assert client.get(f"{API}/auth/me", headers=bearer(old)).status_code == 200
    _user(db).password_changed_at = clock.utc_now()
    db.flush()
    res = client.get(f"{API}/auth/me", headers=bearer(old))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "TOKEN_EXPIRED"
    # 业务接口同样被拒(经 pending 依赖)
    res2 = client.get(f"{API}/me/classes", headers=bearer(old))
    assert (res2.status_code, res2.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")


def test_access_token_issued_before_totp_enable_rejected(client, db, settings):
    _user(db).password_changed_at = clock.utc_now() - timedelta(hours=1)
    db.flush()
    old = _token_at(settings, UID, clock.utc_now() - timedelta(seconds=30))
    assert client.get(f"{API}/auth/me", headers=bearer(old)).status_code == 200
    _enable_totp_row(_user(db), clock.utc_now())
    db.flush()
    res = client.get(f"{API}/auth/me", headers=bearer(old))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_token_issued_same_second_as_password_change_passes(client, db, settings):
    changed = clock.utc_now().replace(microsecond=900_000)
    _user(db).password_changed_at = changed
    db.flush()
    same_second = _token_at(settings, UID, changed.replace(microsecond=0))
    assert client.get(f"{API}/auth/me", headers=bearer(same_second)).status_code == 200
    earlier = _token_at(settings, UID, changed.replace(microsecond=0) - timedelta(seconds=1))
    res = client.get(f"{API}/auth/me", headers=bearer(earlier))
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")


def test_iat_check_uses_later_of_password_and_totp(client, db, settings):
    now = clock.utc_now()
    user = _user(db)
    user.password_changed_at = now - timedelta(seconds=100)
    _enable_totp_row(user, now - timedelta(seconds=10))
    db.flush()
    between = _token_at(settings, UID, now - timedelta(seconds=50))
    res = client.get(f"{API}/auth/me", headers=bearer(between))
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")
    after = _token_at(settings, UID, now - timedelta(seconds=5))
    assert client.get(f"{API}/auth/me", headers=bearer(after)).status_code == 200


def test_fresh_login_token_after_change_not_rejected(client, db):
    _set_security(db, max_age=90)
    _user(db).password_changed_at = clock.utc_now() - timedelta(days=91)
    db.flush()
    t = login(client).json()
    res = client.post(
        f"{API}/auth/password",
        headers=bearer(t["access_token"]),
        json={
            "old_password": "dev123",
            "new_password": "Brand-new-9x",
            "refresh_token": t["refresh_token"],
        },
    )
    assert res.status_code == 200
    # 改密后立刻登录并使用新令牌;刷新得到的令牌同样不被误拒
    fresh = login(client, pw="Brand-new-9x").json()
    assert client.get(f"{API}/me/classes", headers=bearer(fresh["access_token"])).status_code == 200
    ref = client.post(f"{API}/auth/refresh", json={"refresh_token": fresh["refresh_token"]})
    assert ref.status_code == 200
    h = bearer(ref.json()["access_token"])
    assert client.get(f"{API}/me/classes", headers=h).status_code == 200


def test_first_login_token_usable_for_change_password(client, db):
    user = _user(db)
    user.must_change_password = True
    db.flush()
    t = login(client).json()
    assert t["user"]["password_change_reason"] == "first_login"
    me = client.get(f"{API}/auth/me", headers=bearer(t["access_token"]))
    assert me.status_code == 200


def test_archived_user_access_token_rejected(client, db, settings):
    token = auth(settings)["Authorization"].removeprefix("Bearer ")
    assert client.get(f"{API}/auth/me", headers=bearer(token)).status_code == 200
    for status in ("archived", "frozen"):
        _user(db).status = status
        db.flush()
        res = client.get(f"{API}/auth/me", headers=bearer(token))
        assert (res.status_code, res.json()["error"]["code"]) == (401, "UNAUTHORIZED")
        res = client.get(f"{API}/me/classes", headers=bearer(token))
        assert (res.status_code, res.json()["error"]["code"]) == (401, "UNAUTHORIZED")


def test_password_policy_endpoint(client, db, settings):
    h = auth(settings)
    assert client.get(f"{API}/auth/password-policy").status_code == 401
    # 学校设置无行:默认值
    r = client.get(f"{API}/auth/password-policy", headers=h)
    assert r.status_code == 200
    assert r.json() == {"min_length": 8, "max_age_days": 0}
    _set_security(db, max_age=180, min_length=12)
    assert client.get(f"{API}/auth/password-policy", headers=h).json() == {
        "min_length": 12,
        "max_age_days": 180,
    }
    # 需要改密码的账号也能读
    _user(db).must_change_password = True
    db.flush()
    pending = client.get(f"{API}/auth/password-policy", headers=h)
    assert pending.status_code == 200
    assert pending.json() == {"min_length": 12, "max_age_days": 180}


_PENDING_NAMES = {"get_current_user_pending", "CurrentUser"}


def _pending_users(source: str) -> set[str]:
    """源码里引用了 get_current_user_pending(含别名 CurrentUser 及其再别名)的位置:

    函数名(参数注解、默认值、装饰器的 dependencies=[...]、函数体内任何位置都算),
    或 "<module>"(模块级的非别名定义,例如 APIRouter(dependencies=[...]))。
    """
    import ast

    tree = ast.parse(source)
    aliases = set(_PENDING_NAMES)

    def refs(node: ast.AST) -> bool:
        return any(
            (isinstance(n, ast.Name) and n.id in aliases)
            or (isinstance(n, ast.Attribute) and n.attr in aliases)
            for n in ast.walk(node)
        )

    for stmt in tree.body:  # 别名:from ... import x as y;Y = X / Annotated[..., Depends(X)]
        if isinstance(stmt, ast.ImportFrom):
            aliases |= {a.asname for a in stmt.names if a.name in aliases and a.asname}
    grew = True
    while grew:
        grew = False
        for stmt in tree.body:
            if isinstance(stmt, ast.Assign | ast.AnnAssign) and stmt.value is not None:
                targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
                for t in targets:
                    if isinstance(t, ast.Name) and t.id not in aliases and refs(stmt.value):
                        aliases.add(t.id)
                        grew = True
    hits: set[str] = set()
    for stmt in tree.body:
        if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef):
            if refs(stmt):
                hits.add(stmt.name)
        elif isinstance(stmt, ast.ClassDef):
            if refs(stmt):
                hits.add(stmt.name)
        elif isinstance(stmt, ast.Assign | ast.AnnAssign) and stmt.value is not None:
            if isinstance(stmt.value, ast.Call) and refs(stmt.value):
                hits.add("<module>")  # 纯类型别名(Annotated[...])是允许的定义
        elif not isinstance(stmt, ast.Import | ast.ImportFrom) and refs(stmt):
            hits.add("<module>")
    return hits


def test_pending_dependency_only_on_allowed_routes():
    """只有 /auth/me、/auth/password、/auth/password-policy 允许需改密码的账号访问。"""
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "app"
    users = {
        str(path.relative_to(root))
        for path in root.rglob("*.py")
        if "get_current_user_pending" in path.read_text(encoding="utf-8")
    }
    assert users == {"auth/deps.py", "auth/router.py"}
    hits = _pending_users((root / "auth" / "router.py").read_text(encoding="utf-8"))
    assert hits == {"me", "change_password", "password_policy"}


def test_pending_scanner_catches_violations():
    base = "from app.auth.deps import get_current_user_pending\nfrom fastapi import Depends\n"
    direct = base + "def x(user=Depends(get_current_user_pending)): ...\n"
    assert _pending_users(direct) == {"x"}
    in_decorator = (
        base + '@router.get("/y", dependencies=[Depends(get_current_user_pending)])\ndef y(): ...\n'
    )
    assert _pending_users(in_decorator) == {"y"}
    in_body = base + "def z():\n    return Depends(get_current_user_pending)\n"
    assert _pending_users(in_body) == {"z"}
    alias = (
        base + "P = Annotated[User, Depends(get_current_user_pending)]\nQ = P\ndef w(u: Q): ...\n"
    )
    assert _pending_users(alias) == {"w"}
    renamed = (
        "from app.auth.deps import get_current_user_pending as gp\ndef v(u=Depends(gp)): ...\n"
    )
    assert _pending_users(renamed) == {"v"}
    attr = "import app.auth.deps as d\ndef u(x=Depends(d.get_current_user_pending)): ...\n"
    assert _pending_users(attr) == {"u"}
    module_level = base + "router = APIRouter(dependencies=[Depends(get_current_user_pending)])\n"
    assert _pending_users(module_level) == {"<module>"}
    clean = base + "def ok(user=Depends(get_current_user)): ...\n"
    assert _pending_users(clean) == set()


# ---- 空库起步(init-school)----


def test_init_school_admin_can_login_and_not_expired(db, settings, redis_client, monkeypatch):
    from uuid import uuid4

    from fastapi.testclient import TestClient

    from app.db import get_db, session_scope
    from app.deploy.bootstrap import init_school
    from app.main import create_app
    from app.redis import get_redis
    from tests.conftest import _reuse

    new = settings.model_copy(update={"school_id": uuid4()})
    init_school(db, new, name="空库学校", admin_login="admin01", admin_password="Test-Pass-123x")
    admin = db.scalars(select(User).where(User.login_name == "admin01")).one()
    db.refresh(admin)
    assert admin.password_changed_at is not None
    app = create_app(new)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    app.dependency_overrides[session_scope] = lambda: _reuse(db)
    app.state.ai_transport = None
    c = TestClient(app)
    # 学校把有效期设为 90 天:刚建的账号不会被判过期,只因临时密码被要求首次改密
    save_security(
        db,
        new.school_id,
        SecuritySettings(totp_allowed=False, password_min_length=8, password_max_age_days=90),
        admin.id,
    )
    r = login(c, "admin01", "Test-Pass-123x")
    assert r.status_code == 200
    assert r.json()["user"]["password_change_reason"] == "first_login"
    token = r.json()["access_token"]
    me = c.get(f"{API}/auth/me", headers=bearer(token))
    assert me.status_code == 200 and me.json()["password_change_reason"] == "first_login"
    # 完成首次改密后:不再有任何原因,也不被判过期
    admin.must_change_password = False
    db.flush()
    again = login(c, "admin01", "Test-Pass-123x").json()
    assert again["user"]["password_change_reason"] is None
    assert again["user"]["must_change_password"] is False
    assert c.get(f"{API}/auth/me", headers=bearer(again["access_token"])).status_code == 200
