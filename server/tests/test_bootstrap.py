"""init-school:首次安装的学校与管理员初始化。"""

import io
from contextlib import contextmanager
from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.cli import build_parser, init_school_cmd
from app.config import Settings
from app.db import get_db, session_scope
from app.deploy.bootstrap import InitError, first_year_for, init_school
from app.main import create_app
from app.models import AcademicYear, RoleBinding, School, User
from app.models.audit import AuditLog
from app.redis import get_redis
from tests.conftest import _reuse
from tests.helpers import freeze

PW = "Test-Pass-123x"


@pytest.fixture
def new_settings(settings: Settings, monkeypatch) -> Settings:
    """另一个学校 id:库里(开发种子)已有学校,这里模拟全新安装。"""
    s = settings.model_copy(update={"school_id": uuid4()})
    monkeypatch.setattr("app.cli.get_settings", lambda: s)
    return s


@pytest.fixture
def new_client(new_settings: Settings, db: Session, redis_client: Redis) -> TestClient:
    app = create_app(new_settings)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    app.dependency_overrides[session_scope] = lambda: _reuse(db)
    app.state.ai_transport = None
    return TestClient(app)


def _login(client, name="admin01", pw=PW):
    return client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})


def _init(db, settings, **kw):
    args = {"name": "测试学校", "admin_login": "admin01", "admin_password": PW} | kw
    return init_school(db, settings, **args)


def _run_cli(db, argv, stdin_text):
    @contextmanager
    def factory():
        yield db

    out = io.StringIO()
    ns = build_parser().parse_args(["init-school", *argv])
    code = init_school_cmd(ns, db_factory=factory, stdin=io.StringIO(stdin_text), out=out)
    return code, out.getvalue()


def _school_count(db, settings) -> int:
    return db.scalar(
        select(func.count()).select_from(School).where(School.id == settings.school_id)
    )


def test_init_school_creates_school_and_admin(db, new_settings, new_client):
    assert _init(db, new_settings) == "created"
    school = db.get(School, new_settings.school_id)
    assert school is not None and school.name == "测试学校"
    r = _login(new_client)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["contexts"] == ["admin"]
    assert body["user"]["must_change_password"] is True
    me = new_client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    ).json()
    assert me["contexts"] == ["admin"]
    assert me["must_change_password"] is True
    binding = db.scalars(select(RoleBinding).join(User).where(User.login_name == "admin01")).one()
    assert binding.role_type == "it_admin" and binding.academic_year_id is None
    assert binding.scope == {"school_id": str(new_settings.school_id)}
    uid = binding.user_id
    assert db.scalar(text("SELECT count(*) FROM teachers WHERE user_id = :u"), {"u": uid}) == 1


def test_admin_scope_grants_settings_manage(db, new_settings, new_client):
    _init(db, new_settings)
    # 首次登录须先改密码(此时管理接口 403);这里只验证角色绑定的 scope 生效
    db.execute(text("UPDATE users SET must_change_password = false WHERE login_name = 'admin01'"))
    token = _login(new_client).json()["access_token"]
    r = new_client.get(
        "/api/v1/admin/settings/switches", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 200, r.text


def test_init_school_idempotent(db, new_settings, new_client):
    assert _init(db, new_settings) == "created"
    users = db.scalar(select(func.count()).select_from(User))
    audits = db.scalar(select(func.count()).select_from(AuditLog))
    assert _init(db, new_settings, name="另一个名字", admin_login="other01") == "exists"
    assert db.scalar(select(func.count()).select_from(User)) == users
    assert db.scalar(select(func.count()).select_from(AuditLog)) == audits
    assert db.get(School, new_settings.school_id).name == "测试学校"
    assert _login(new_client).status_code == 200


def test_weak_password_rejected(db, new_settings):
    code, out = _run_cli(
        db, ["--name", "测试学校", "--admin-login", "admin01", "--admin-password-stdin"], "abc\n"
    )
    assert code == 1
    assert "abc" not in out and "密码" in out
    assert _school_count(db, new_settings) == 0
    assert (
        db.scalar(select(func.count()).select_from(User).where(User.login_name == "admin01")) == 0
    )


@pytest.mark.parametrize(
    ("kw", "word"),
    [
        ({"admin_login": "ab"}, "登录名"),
        ({"admin_login": "a b c"}, "登录名"),
        ({"admin_login": "管理员账号"}, "登录名"),
        ({"admin_login": "a" * 33}, "登录名"),
        ({"name": ""}, "校名"),
        ({"name": "校" * 51}, "校名"),
    ],
)
def test_invalid_name_or_login_rejected(db, new_settings, kw, word):
    with pytest.raises(InitError, match=word):
        _init(db, new_settings, **kw)
    assert _school_count(db, new_settings) == 0


def test_rollback_when_failure_midway(db, new_settings, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr("app.deploy.bootstrap.record", boom)
    with pytest.raises(RuntimeError):
        _init(db, new_settings)
    assert _school_count(db, new_settings) == 0
    assert (
        db.scalar(select(func.count()).select_from(User).where(User.login_name == "admin01")) == 0
    )
    sid = str(new_settings.school_id)
    assert (
        db.scalar(
            text("SELECT count(*) FROM role_bindings WHERE scope->>'school_id' = :s"), {"s": sid}
        )
        == 0
    )
    assert (
        db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.object_id == sid)) == 0
    )
    assert (
        db.scalar(
            text(
                "SELECT count(*) FROM teachers t JOIN users u ON u.id = t.user_id"
                " WHERE u.school_id = :s"
            ),
            {"s": new_settings.school_id},
        )
        == 0
    )


def test_concurrent_install_loser_gets_exists(db, new_settings, monkeypatch):
    db.add(School(id=new_settings.school_id, name="先到者"))
    db.commit()  # 赢家已提交
    real_get = db.get
    calls = {"n": 0}

    def fake_get(model, ident, *a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            db.expunge_all()  # 模拟另一事务刚提交:本会话还没看到
            return None
        return real_get(model, ident, *a, **k)

    monkeypatch.setattr(db, "get", fake_get)
    assert _init(db, new_settings) == "exists"
    assert (
        db.scalar(select(func.count()).select_from(User).where(User.login_name == "admin01")) == 0
    )


def test_init_school_audit_has_no_password(db, new_settings, monkeypatch):
    with monkeypatch.context() as m:
        freeze(m, "2026-03-15T04:00:00+00:00")
        code, out = _run_cli(
            db,
            ["--name", "测试学校", "--admin-login", "admin01", "--admin-password-stdin"],
            PW + "\n",
        )
    assert code == 0
    assert PW not in out
    row = db.scalars(select(AuditLog).where(AuditLog.action == "system.init")).one()
    assert row.user_id is None and row.success is True
    assert PW not in repr(row.extra) and "password" not in repr(row.extra).lower()
    assert row.extra["year_name"] == "2025-2026学年"


def test_exists_wins_over_validation_in_api_and_cli(db, new_settings):
    assert _init(db, new_settings) == "created"
    # 已初始化后,即使参数非法(空密码、非法登录名),也只回答"已初始化过"
    assert _init(db, new_settings, admin_login="a b", admin_password="") == "exists"
    code, out = _run_cli(db, ["--name", "x", "--admin-login", "!", "--admin-password-stdin"], "\n")
    assert code == 3
    assert "已初始化过" in out


def _years(db, settings) -> list[AcademicYear]:
    return list(
        db.scalars(select(AcademicYear).where(AcademicYear.school_id == settings.school_id)).all()
    )


def _admin_headers(client) -> dict[str, str]:
    token = _login(client).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_init_school_creates_one_active_year(db, new_settings):
    _init(db, new_settings)
    years = _years(db, new_settings)
    assert len(years) == 1 and years[0].is_active is True


@pytest.mark.parametrize(
    ("today", "name", "start", "end", "term2"),
    [
        (date(2026, 3, 15), "2025-2026学年", date(2025, 9, 1), date(2026, 7, 31), date(2026, 2, 1)),
        (date(2026, 9, 10), "2026-2027学年", date(2026, 9, 1), date(2027, 7, 31), date(2027, 2, 1)),
        (date(2026, 8, 1), "2026-2027学年", date(2026, 9, 1), date(2027, 7, 31), date(2027, 2, 1)),
        (date(2026, 7, 31), "2025-2026学年", date(2025, 9, 1), date(2026, 7, 31), date(2026, 2, 1)),
        (date(2027, 1, 1), "2026-2027学年", date(2026, 9, 1), date(2027, 7, 31), date(2027, 2, 1)),
        (
            date(2026, 12, 31),
            "2026-2027学年",
            date(2026, 9, 1),
            date(2027, 7, 31),
            date(2027, 2, 1),
        ),
    ],
)
def test_first_year_for(today, name, start, end, term2):
    assert first_year_for(today) == (name, start, end, term2)


@pytest.mark.parametrize(
    ("iso", "name", "start", "end", "term2"),
    [
        (
            "2026-03-15T04:00:00+00:00",
            "2025-2026学年",
            date(2025, 9, 1),
            date(2026, 7, 31),
            date(2026, 2, 1),
        ),
        (
            "2026-09-10T04:00:00+00:00",
            "2026-2027学年",
            date(2026, 9, 1),
            date(2027, 7, 31),
            date(2027, 2, 1),
        ),
        # UTC 7 月 31 日 20:00 = 上海 8 月 1 日 04:00 → 已是新学年
        (
            "2026-07-31T20:00:00+00:00",
            "2026-2027学年",
            date(2026, 9, 1),
            date(2027, 7, 31),
            date(2027, 2, 1),
        ),
        # UTC 7 月 31 日 15:59 = 上海 7 月 31 日 23:59 → 仍是旧学年
        (
            "2026-07-31T15:59:00+00:00",
            "2025-2026学年",
            date(2025, 9, 1),
            date(2026, 7, 31),
            date(2026, 2, 1),
        ),
    ],
)
def test_init_school_year_follows_school_local_date(
    db, new_settings, monkeypatch, iso, name, start, end, term2
):
    freeze(monkeypatch, iso)
    _init(db, new_settings)
    (year,) = _years(db, new_settings)
    assert (year.name, year.start_date, year.end_date, year.term2_start) == (
        name,
        start,
        end,
        term2,
    )
    assert year.is_active is True


def test_admin_can_create_grade_right_after_install(db, new_settings, new_client):
    _init(db, new_settings)
    db.execute(text("UPDATE users SET must_change_password = false WHERE login_name = 'admin01'"))
    r = new_client.post(
        "/api/v1/admin/grades",
        json={"name": "七年级", "display_order": 1},
        headers=_admin_headers(new_client),
    )
    assert r.status_code == 201, r.text


def test_fresh_install_admin_builds_grade_and_class_via_api(db, new_settings, new_client):
    """L127:从 `init-school` 空库起步走完整链路——首次登录改密码、建年级、建班、列出。
    G-1 时 init-school 没建学年,建年级直接 409 NO_ACTIVE_YEAR,只在验收时暴露;这条把它钉进 CI。"""
    code, out = _run_cli(
        db, ["--name", "测试学校", "--admin-login", "admin01", "--admin-password-stdin"], PW + "\n"
    )
    assert code == 0, out
    first = _login(new_client).json()
    assert first["user"]["must_change_password"] is True
    new_pw = "Changed-Pass-456y"
    r = new_client.post(
        "/api/v1/auth/password",
        headers={"Authorization": f"Bearer {first['access_token']}"},
        json={"old_password": PW, "new_password": new_pw, "refresh_token": first["refresh_token"]},
    )
    assert r.status_code == 200, r.text
    # R6:改密前签发的 access 令牌可能因同一秒被拒,用保留的刷新令牌换新令牌后再调管理接口
    token = new_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    grade = new_client.post(
        "/api/v1/admin/grades", json={"name": "一年级", "display_order": 1}, headers=h
    )
    assert grade.status_code == 201, grade.text
    cls = new_client.post(
        "/api/v1/admin/classes",
        json={"grade_id": grade.json()["id"], "name": "一年一班", "room": "教学楼 101"},
        headers=h,
    )
    assert cls.status_code == 201, cls.text
    listed = new_client.get("/api/v1/admin/classes", headers=h)
    assert listed.status_code == 200, listed.text
    assert [(c["grade_name"], c["name"]) for c in listed.json()] == [("一年级", "一年一班")]


def test_init_school_again_keeps_single_year(db, new_settings):
    _init(db, new_settings)
    (before,) = _years(db, new_settings)
    assert _init(db, new_settings) == "exists"
    (after,) = _years(db, new_settings)
    assert after.id == before.id and after.name == before.name


def test_init_school_exists_does_not_backfill_year(db, new_settings):
    _init(db, new_settings)
    db.execute(
        text("DELETE FROM academic_years WHERE school_id = :s"), {"s": new_settings.school_id}
    )
    assert _init(db, new_settings) == "exists"
    assert _years(db, new_settings) == []


def test_rollback_leaves_no_year(db, new_settings, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr("app.deploy.bootstrap.record", boom)
    with pytest.raises(RuntimeError):
        _init(db, new_settings)
    assert _years(db, new_settings) == []


def test_admin_years_lists_exactly_the_first_year(db, new_settings, new_client, monkeypatch):
    with monkeypatch.context() as m:
        freeze(m, "2026-03-15T04:00:00+00:00")
        _init(db, new_settings)
    db.execute(text("UPDATE users SET must_change_password = false WHERE login_name = 'admin01'"))
    r = new_client.get("/api/v1/admin/years", headers=_admin_headers(new_client))
    assert r.status_code == 200, r.text
    (item,) = r.json()
    assert item["name"] == "2025-2026学年" and item["is_active"] is True
    assert item["start_date"] == "2025-09-01" and item["end_date"] == "2026-07-31"
    assert item["term2_start"] == "2026-02-01"
