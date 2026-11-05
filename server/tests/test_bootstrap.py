"""init-school:首次安装的学校与管理员初始化。"""

import io
from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.cli import build_parser, init_school_cmd
from app.config import Settings
from app.db import get_db, session_scope
from app.deploy.bootstrap import InitError, init_school
from app.main import create_app
from app.models import RoleBinding, School, User
from app.models.audit import AuditLog
from app.redis import get_redis
from tests.conftest import _reuse

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


def test_init_school_audit_has_no_password(db, new_settings):
    code, out = _run_cli(
        db, ["--name", "测试学校", "--admin-login", "admin01", "--admin-password-stdin"], PW + "\n"
    )
    assert code == 0
    assert PW not in out
    row = db.scalars(select(AuditLog).where(AuditLog.action == "system.init")).one()
    assert row.user_id is None and row.success is True
    assert PW not in repr(row.extra) and "password" not in repr(row.extra).lower()
