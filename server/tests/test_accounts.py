from datetime import timedelta

from sqlalchemy import func, select

from app import clock
from app.models import User
from app.models.audit import AuditLog
from tests.helpers import audit_rows, auth

ACCOUNTS = "/api/v1/admin/accounts"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
DEAN = "55555555-5555-5555-5555-555555555544"
NEW = {
    "login_name": "newteacher01",
    "display_name": "钱老师",
    "phone": "13800000021",
    "employee_no": "T101",
    "subjects": ["语文", "数学"],
}


def _admin(settings):
    return auth(settings, IT_ADMIN)


def _login(client, name, pw="dev123"):
    return client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _create(client, settings, **over):
    return client.post(ACCOUNTS, headers=_admin(settings), json={**NEW, **over})


def _user_id(db, login):
    return db.scalars(select(User.id).where(User.login_name == login)).one()


def test_list_filters(client, settings):
    h = _admin(settings)
    res = client.get(ACCOUNTS, headers=h, params={"q": "校长"}).json()
    assert [a["login_name"] for a in res["items"]] == ["principal01"]
    assert res["total"] == 1
    assert res["items"][0]["roles"] == [{"role": "principal", "label": "校长"}]
    res = client.get(ACCOUNTS, headers=h, params={"role": "grade_head"}).json()
    assert [a["login_name"] for a in res["items"]] == ["gradehead03"]
    assert res["items"][0]["roles"] == [{"role": "grade_head", "label": "三年级 组长"}]
    assert client.get(ACCOUNTS, headers=h, params={"status": "frozen"}).json() == {
        "items": [],
        "total": 0,
    }
    res = client.get(ACCOUNTS, headers=h, params={"q": "TEACHER01"}).json()
    item = res["items"][0]
    assert item["login_name"] == "teacher01"
    assert item["roles"] == [{"role": "homeroom_teacher", "label": "三年二班 班主任"}]
    assert item["employee_no"] == "T001" and item["subjects"] == ["语文"]
    assert item["status"] == "active" and item["must_change_password"] is False
    everyone = client.get(ACCOUNTS, headers=h).json()
    assert everyone["total"] == len(everyone["items"]) >= 9
    assert client.get(ACCOUNTS, headers=h, params={"page": 2}).json()["items"] == []


def test_create_account_temp_password_works_once(client, settings, db, caplog, capsys):
    res = _create(client, settings)
    assert res.status_code == 201
    body = res.json()
    temp = body["temp_password"]
    assert len(temp) == 10
    assert body["account"]["login_name"] == "newteacher01"
    assert body["account"]["must_change_password"] is True
    assert body["account"]["subjects"] == ["语文", "数学"]
    assert body["account"]["employee_no"] == "T101"
    assert "temp_password" not in client.get(ACCOUNTS, headers=_admin(settings)).text

    tokens = _login(client, "newteacher01", temp).json()
    assert tokens["user"]["must_change_password"] is True
    h = _bearer(tokens["access_token"])
    blocked = client.get("/api/v1/me/classes", headers=h)
    assert blocked.status_code == 403
    changed = client.post(
        "/api/v1/auth/password",
        headers=h,
        json={
            "old_password": temp,
            "new_password": "NewPass-2026",
            "refresh_token": tokens["refresh_token"],
        },
    )
    assert changed.status_code == 200
    # R6:改密之前签发的 access 令牌不再有效;本会话用保留的刷新令牌换新令牌后继续可用
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    h2 = _bearer(refreshed.json()["access_token"])
    assert client.get("/api/v1/me/classes", headers=h2).status_code == 200
    # 同一整秒内签发的旧令牌会被放行(取整到秒),把改密时间推后几秒让断言与时钟无关
    user = db.scalars(select(User).where(User.login_name == "newteacher01")).one()
    user.password_changed_at = user.password_changed_at + timedelta(seconds=5)
    db.flush()
    stale = client.get("/api/v1/me/classes", headers=h)
    assert stale.status_code == 401
    assert stale.json()["error"]["code"] == "TOKEN_EXPIRED"
    assert _login(client, "newteacher01", temp).status_code == 401

    for row in db.scalars(select(AuditLog)).all():
        assert temp not in repr(row.extra)
    assert temp not in caplog.text
    out = capsys.readouterr()
    assert temp not in out.out + out.err
    rows = audit_rows(db, body["account"]["id"])
    assert [r.action for r in rows] == ["account.create", "account.password_change"]
    assert rows[0].success is True and rows[0].object_type == "user"


def test_login_name_rules(client, settings):
    assert _create(client, settings, login_name="ab").status_code == 400
    assert _create(client, settings, login_name="bad name").status_code == 400
    assert _create(client, settings, login_name="x" * 33).status_code == 400
    taken = _create(client, settings, login_name="Teacher01")
    assert taken.status_code == 409
    assert taken.json()["error"]["code"] == "LOGIN_TAKEN"
    assert _create(client, settings, phone="123").status_code == 400
    assert _create(client, settings, subjects=["a"] * 7).status_code == 400
    assert _create(client, settings, display_name="").status_code == 400
    assert _create(client, settings, phone=None, employee_no=None, subjects=[]).status_code == 201


def test_update_account(client, settings, db):
    created = _create(client, settings).json()["account"]
    res = client.put(
        f"{ACCOUNTS}/{created['id']}",
        headers=_admin(settings),
        json={
            "display_name": "钱老师B",
            "phone": None,
            "employee_no": "T102",
            "subjects": ["英语"],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["login_name"] == "newteacher01"
    assert (body["display_name"], body["phone"]) == ("钱老师B", None)
    assert (body["employee_no"], body["subjects"]) == ("T102", ["英语"])
    assert [r.action for r in audit_rows(db, created["id"])][-1] == "account.update"
    missing = client.put(
        f"{ACCOUNTS}/00000000-0000-0000-0000-000000000000",
        headers=_admin(settings),
        json={"display_name": "x", "phone": None, "employee_no": None, "subjects": []},
    )
    assert missing.status_code == 404


def test_reset_password_revokes_sessions(client, settings, db):
    first = _login(client, "teacher02").json()
    second = _login(client, "teacher02").json()
    res = client.post(
        f"{ACCOUNTS}/{_user_id(db, 'teacher02')}/reset-password", headers=_admin(settings)
    )
    assert res.status_code == 200
    temp = res.json()["temp_password"]
    assert len(temp) == 10
    for t in (first, second):
        ref = client.post("/api/v1/auth/refresh", json={"refresh_token": t["refresh_token"]})
        assert ref.status_code == 401
    assert _login(client, "teacher02").status_code == 401
    again = _login(client, "teacher02", temp)
    assert again.status_code == 200
    assert again.json()["user"]["must_change_password"] is True
    rows = audit_rows(db, _user_id(db, "teacher02"))
    assert [r.action for r in rows] == ["account.reset_password"]
    assert all(temp not in repr(r.extra) for r in rows)


def test_freeze_logs_user_out_everywhere(client, settings, db):
    tokens = _login(client, "teacher02").json()
    h = _bearer(tokens["access_token"])
    assert client.get("/api/v1/me/classes", headers=h).status_code == 200
    uid = _user_id(db, "teacher02")
    res = client.post(f"{ACCOUNTS}/{uid}/freeze", headers=_admin(settings))
    assert res.status_code == 200
    assert res.json()["status"] == "frozen"
    assert client.get("/api/v1/me/classes", headers=h).status_code == 401
    ref = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert ref.status_code == 401
    assert _login(client, "teacher02").status_code == 401
    listed = client.get(ACCOUNTS, headers=_admin(settings), params={"status": "frozen"}).json()
    assert [a["login_name"] for a in listed["items"]] == ["teacher02"]

    back = client.post(f"{ACCOUNTS}/{uid}/unfreeze", headers=_admin(settings))
    assert back.status_code == 200 and back.json()["status"] == "active"
    assert _login(client, "teacher02").status_code == 200
    assert [r.action for r in audit_rows(db, uid)] == ["account.freeze", "account.unfreeze"]


def test_cannot_freeze_self(client, settings, db):
    res = client.post(f"{ACCOUNTS}/{IT_ADMIN}/freeze", headers=_admin(settings))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CANNOT_FREEZE_SELF"
    assert db.get(User, _user_id(db, "itadmin01")).status == "active"
    assert client.get(ACCOUNTS, headers=_admin(settings)).status_code == 200


def test_accounts_require_permission(client, settings, db):
    h = auth(settings, DEAN)
    assert client.get(ACCOUNTS, headers=h).status_code == 403
    assert client.post(ACCOUNTS, headers=h, json=NEW).status_code == 403
    target = _user_id(db, "teacher02")
    for tail in ("reset-password", "freeze", "unfreeze"):
        assert client.post(f"{ACCOUNTS}/{target}/{tail}", headers=h).status_code == 403
    assert client.post(f"{ACCOUNTS}/import/preview", headers=h, json={"csv": ""}).status_code == 403
    assert client.post(f"{ACCOUNTS}/import", headers=h, json={"csv": ""}).status_code == 403
    denied = [r for r in db.scalars(select(AuditLog)).all() if r.user_id == _user_id(db, "dean01")]
    assert denied and all(r.success is False for r in denied)
    assert db.get(User, target).status == "active"
    assert client.get(ACCOUNTS, headers=auth(settings, target)).status_code == 403


def test_phone_rejects_non_ascii_digits(client, settings):
    assert _create(client, settings, phone="١٣٨٠٠٠٠٠٠٢١").status_code == 400
    assert _create(client, settings, phone="13800000021").status_code == 201


def test_create_race_integrity_error_becomes_login_taken(client, settings, db, monkeypatch):
    from app.domain.accounts import service

    monkeypatch.setattr(service, "_existing_logins", lambda db, school_id: set())
    before = db.scalar(select(func.count()).select_from(User))
    res = _create(client, settings, login_name="teacher01")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "LOGIN_TAKEN"
    assert db.scalar(select(func.count()).select_from(User)) == before


def test_temp_password_responses_not_cached(client, settings, db):
    h = _admin(settings)
    created = _create(client, settings)
    assert created.headers["cache-control"] == "no-store"
    reset = client.post(f"{ACCOUNTS}/{_user_id(db, 'teacher02')}/reset-password", headers=h)
    assert reset.headers["cache-control"] == "no-store"
    imported = client.post(
        f"{ACCOUNTS}/import", headers=h, json={"csv": "登录名,姓名,工号,科目,手机\nimp_a,甲,,,"}
    )
    assert imported.status_code == 201
    assert imported.headers["cache-control"] == "no-store"


def test_other_school_user_is_404(client, settings, db):
    from uuid import uuid4

    from app.models import School
    from tests.factories import make_user

    other = School(name="外校")
    db.add(other)
    db.flush()
    stranger = make_user(db, f"stranger_{uuid4().hex[:6]}")
    stranger.school_id = other.id
    db.commit()
    h = _admin(settings)
    for tail in ("freeze", "reset-password", "unfreeze"):
        assert client.post(f"{ACCOUNTS}/{stranger.id}/{tail}", headers=h).status_code == 404
    body = {"display_name": "x", "phone": None, "employee_no": None, "subjects": []}
    assert client.put(f"{ACCOUNTS}/{stranger.id}", headers=h, json=body).status_code == 404
    assert db.get(User, stranger.id).status == "active"


def test_unfreeze_keeps_must_change_password(client, settings, db):
    uid = _user_id(db, "teacher02")
    db.get(User, uid).must_change_password = True
    db.commit()
    h = _admin(settings)
    client.post(f"{ACCOUNTS}/{uid}/freeze", headers=h)
    back = client.post(f"{ACCOUNTS}/{uid}/unfreeze", headers=h).json()
    assert back["status"] == "active" and back["must_change_password"] is True


def test_freeze_takes_last_admin_lock(client, settings, db):
    from sqlalchemy import event

    seen: list[str] = []
    conn = db.connection()

    def spy(conn_, cursor, statement, parameters, context, executemany):
        if "pg_advisory_xact_lock" in statement:
            seen.append(str(parameters))

    event.listen(conn, "before_cursor_execute", spy)
    try:
        principal = auth(settings, "55555555-5555-5555-5555-555555555543")
        res = client.post(f"{ACCOUNTS}/{IT_ADMIN}/freeze", headers=principal)
    finally:
        event.remove(conn, "before_cursor_execute", spy)
    assert res.status_code == 200
    assert len(seen) == 1 and "last-admin:11111111-1111-1111-1111-111111111111" in seen[0]


def test_freeze_last_admin_rejected(client, settings, db, monkeypatch):
    from app.domain.accounts import service

    monkeypatch.setattr(service, "account_admin_count", lambda db, school_id, **kw: 1)
    principal = auth(settings, "55555555-5555-5555-5555-555555555543")
    res = client.post(f"{ACCOUNTS}/{IT_ADMIN}/freeze", headers=principal)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "LAST_ADMIN"
    assert db.get(User, _user_id(db, "itadmin01")).status == "active"
    # 非管理员目标不受影响
    ok = client.post(f"{ACCOUNTS}/{_user_id(db, 'teacher02')}/freeze", headers=principal)
    assert ok.status_code == 200


def test_login_name_unique_index_is_case_insensitive(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    from tests.factories import make_user

    make_user(db, "CaseUser")
    with pytest.raises(IntegrityError), db.begin_nested():
        make_user(db, "caseuser")


def test_cannot_reset_self(client, settings, db):
    res = client.post(f"{ACCOUNTS}/{IT_ADMIN}/reset-password", headers=_admin(settings))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CANNOT_RESET_SELF"
    assert res.json()["error"]["message"] == "不能重置自己的密码，请用修改密码"
    assert db.get(User, IT_ADMIN).must_change_password is False
    assert _login(client, "itadmin01").status_code == 200


def test_reset_clears_login_lock(client, settings, db):
    for _ in range(settings.login_max_failures):
        assert _login(client, "teacher02", "wrong-pass").status_code == 401
    assert _login(client, "teacher02").status_code == 429
    res = client.post(
        f"{ACCOUNTS}/{_user_id(db, 'teacher02')}/reset-password", headers=_admin(settings)
    )
    temp = res.json()["temp_password"]
    assert _login(client, "teacher02", temp).status_code == 200


def test_freeze_publishes_session_revoked_only_when_accepted(client, settings, db, monkeypatch):
    from app.domain.accounts import service

    calls: list = []
    monkeypatch.setattr(service, "publish", lambda redis, ids, event: calls.append((ids, event)))
    principal = auth(settings, "55555555-5555-5555-5555-555555555543")
    # 被拒的冻结不发布
    assert client.post(f"{ACCOUNTS}/{IT_ADMIN}/freeze", headers=_admin(settings)).status_code == 409
    monkeypatch.setattr(service, "account_admin_count", lambda db, school_id, **kw: 1)
    res = client.post(f"{ACCOUNTS}/{IT_ADMIN}/freeze", headers=principal)
    assert res.json()["error"]["code"] == "LAST_ADMIN"
    assert calls == []
    # 成功的冻结在提交后发布一次
    uid = _user_id(db, "teacher02")
    assert client.post(f"{ACCOUNTS}/{uid}/freeze", headers=principal).status_code == 200
    assert calls == [([uid], {"type": "session.revoked"})]


def test_freeze_succeeds_when_publish_redis_fails(client, settings, db, redis_client, monkeypatch):
    from redis.exceptions import ConnectionError as RedisConnectionError

    def boom(*args, **kwargs):
        raise RedisConnectionError("down")

    monkeypatch.setattr(redis_client, "publish", boom)
    uid = _user_id(db, "teacher02")
    res = client.post(f"{ACCOUNTS}/{uid}/freeze", headers=_admin(settings))
    assert res.status_code == 200


def test_parent_tag_and_filter(client, settings):
    h = _admin(settings)
    res = client.get(ACCOUNTS, headers=h, params={"q": "13800000061"}).json()
    assert [a["login_name"] for a in res["items"]] == ["13800000061"]
    assert res["items"][0]["roles"] == [{"role": "parent", "label": "家长"}]
    items = client.get(ACCOUNTS, headers=h, params={"role": "parent"}).json()["items"]
    assert {a["login_name"] for a in items} == {"13800000061", "13800000062", "teacher04"}
    teacher04 = next(a for a in items if a["login_name"] == "teacher04")
    assert {"role": "parent", "label": "家长"} in teacher04["roles"]
    assert any(r["role"] == "homeroom_teacher" for r in teacher04["roles"])
    other = client.get(ACCOUNTS, headers=h, params={"role": "homeroom_teacher"}).json()["items"]
    assert "13800000061" not in {a["login_name"] for a in other}


def test_list_page_and_q_caps(client, settings):
    h = _admin(settings)
    # 项目口径:查询参数校验失败统一 400 BAD_REQUEST
    assert client.get(ACCOUNTS, headers=h, params={"page": 1000}).status_code == 200
    assert client.get(ACCOUNTS, headers=h, params={"page": 1001}).status_code == 400
    assert client.get(ACCOUNTS, headers=h, params={"q": "字" * 50}).status_code == 200
    assert client.get(ACCOUNTS, headers=h, params={"q": "字" * 51}).status_code == 400


def test_update_parent_account_keeps_it_parent_only(client, settings, db):
    from sqlalchemy import text

    from tests.seed_ids import STUDENT_IDS

    created = client.post(
        f"/api/v1/students/{STUDENT_IDS[2]}/parents",
        headers=auth(settings),
        json={"phone": "13800000041", "name": "虚构家长", "relation": "母亲"},
    )
    assert created.status_code == 201, created.text
    link_id = created.json()["parent"]["link_id"]
    uid = _user_id(db, "13800000041")
    res = client.put(
        f"{ACCOUNTS}/{uid}",
        headers=_admin(settings),
        json={
            "display_name": "虚构家长B",
            "phone": "13800000041",
            "employee_no": None,
            "subjects": [],
        },
    )
    assert res.status_code == 200, res.text
    assert db.scalar(text("SELECT count(*) FROM teachers WHERE user_id = :u"), {"u": uid}) == 0
    assert (
        client.delete(f"/api/v1/parent-links/{link_id}", headers=auth(settings)).status_code == 204
    )
    db.expire_all()
    assert db.get(User, uid).status == "archived"
    # 填了工号则照常建教职工行
    other = _create(client, settings).json()["account"]["id"]
    assert db.scalar(text("SELECT count(*) FROM teachers WHERE user_id = :u"), {"u": other}) == 1


def test_role_tags_ignore_yearless_teacher_binding(client, settings, db):
    from app.rbac.roles import Role
    from tests.factories import bind, make_teacher_account
    from tests.seed_ids import CLASS_ID

    t = make_teacher_account(db, login_name="yearless01")
    bind(db, t.id, Role.homeroom_teacher, class_id=CLASS_ID, year_id=None)
    bind(db, t.id, Role.subject_teacher, class_id=CLASS_ID, year_id=None, subject="数学")
    db.commit()
    items = client.get(ACCOUNTS, headers=_admin(settings), params={"q": "yearless01"}).json()[
        "items"
    ]
    assert items[0]["roles"] == []
    # 管理岗学年为空照旧显示
    p = client.get(ACCOUNTS, headers=_admin(settings), params={"q": "principal01"}).json()["items"]
    assert p[0]["roles"] == [{"role": "principal", "label": "校长"}]


def test_admin_reset_kicks_socket(client, settings, db, redis_client):
    import json

    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    uid = _user_id(db, "teacher02")
    res = client.post(f"{ACCOUNTS}/{uid}/reset-password", headers=_admin(settings))
    assert res.status_code == 200
    seen = []
    while (msg := pubsub.get_message(timeout=0.5)) is not None:
        if msg["type"] == "message":
            seen.append(json.loads(msg["data"]))
    pubsub.close()
    assert seen == [{"user_ids": [str(uid)], "event": {"type": "session.stale"}}]


def _revoke_boom(monkeypatch):
    from redis.exceptions import RedisError

    from app.auth import sessions

    def boom(*args, **kwargs):
        raise RedisError("down")

    monkeypatch.setattr(sessions, "revoke_all", boom)


def test_reset_redis_error_leaves_password_unchanged(client, settings, db, monkeypatch):
    uid = _user_id(db, "teacher02")
    before = db.get(User, uid).password_hash
    _revoke_boom(monkeypatch)
    res = client.post(f"{ACCOUNTS}/{uid}/reset-password", headers=_admin(settings))
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "temp_password" not in res.text
    db.expire_all()
    assert db.get(User, uid).password_hash == before
    assert db.get(User, uid).must_change_password is False
    assert audit_rows(db, uid) == []
    monkeypatch.undo()
    assert _login(client, "teacher02").status_code == 200


def test_freeze_redis_error_leaves_account_active(client, settings, db, monkeypatch):
    uid = _user_id(db, "teacher02")
    _revoke_boom(monkeypatch)
    res = client.post(f"{ACCOUNTS}/{uid}/freeze", headers=_admin(settings))
    assert res.status_code == 503 and res.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    db.expire_all()
    assert db.get(User, uid).status == "active"


def test_admin_reset_sets_password_changed_at(client, settings, db):
    uid = _user_id(db, "teacher02")
    before = clock.utc_now() - timedelta(days=1)
    db.get(User, uid).password_changed_at = before
    db.commit()
    res = client.post(f"{ACCOUNTS}/{uid}/reset-password", headers=_admin(settings))
    assert res.status_code == 200
    db.expire_all()
    after = db.scalar(select(User.password_changed_at).where(User.id == uid))
    assert after is not None and after > before


def test_account_list_includes_totp_enabled(client, settings, db):
    uid = _user_id(db, "teacher02")
    user = db.get(User, uid)
    user.totp_secret = "FICTIONALSECRET"
    user.totp_enabled_at = clock.utc_now()
    db.commit()
    res = client.get(ACCOUNTS, headers=_admin(settings), params={"q": "teacher"})
    assert res.status_code == 200
    flags = {i["login_name"]: i["totp_enabled"] for i in res.json()["items"]}
    assert flags["teacher02"] is True
    assert [k for k, v in flags.items() if v] == ["teacher02"]


def test_reset_succeeds_when_fail_counter_cleanup_redis_fails(
    client, settings, db, redis_client, monkeypatch
):
    from redis.exceptions import RedisError

    def boom(*args, **kwargs):
        raise RedisError("down")

    monkeypatch.setattr(redis_client, "delete", boom)  # revoke_all 走 pipeline,不受影响
    res = client.post(
        f"{ACCOUNTS}/{_user_id(db, 'teacher02')}/reset-password", headers=_admin(settings)
    )
    assert res.status_code == 200
    temp = res.json()["temp_password"]
    assert len(temp) == 10
    monkeypatch.undo()
    assert _login(client, "teacher02", temp).status_code == 200
