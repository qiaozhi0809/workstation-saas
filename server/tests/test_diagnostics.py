import io
import json
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
import structlog
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import Settings
from app.db import get_db
from app.deploy.diagnostics import build_bundle, mask_line, mask_settings
from app.logging import configure_logging
from app.main import create_app
from app.models import Student
from app.models.audit import AuditLog
from app.redis import get_redis
from tests.helpers import auth

INFO = "/api/v1/admin/system/info"
DIAG = "/api/v1/admin/system/diagnostics"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER = "55555555-5555-5555-5555-555555555555"
PARENT = "55555555-5555-5555-5555-555555555561"

FILES = {"version.json", "config.json", "schema.json", "counts.json", "logs.jsonl"}
FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXIifQ.ZmFrZS1zaWduYXR1cmUtMDEyMzQ1"
NOW = datetime(2026, 11, 5, 8, 30, 15, tzinfo=UTC)


def _zip(content: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(content))


@pytest.fixture(autouse=True)
def _restore_logging():
    yield
    configure_logging("INFO")


@pytest.fixture
def log_settings(settings, tmp_path) -> Settings:
    return settings.model_copy(update={"log_dir": tmp_path})


def test_diagnostics_requires_settings_manage(client, settings, db):
    for user in (TEACHER, DEAN, PARENT):
        assert client.get(DIAG, headers=auth(settings, user)).status_code == 403
        assert client.get(INFO, headers=auth(settings, user)).status_code == 403
    assert client.get(DIAG).status_code == 401
    assert client.get(INFO).status_code == 401
    for user in (PRINCIPAL, IT_ADMIN):
        res = client.get(DIAG, headers=auth(settings, user))
        assert res.status_code == 200, res.text
        assert res.headers["content-type"] == "application/zip"
        assert res.headers["content-disposition"].startswith(
            'attachment; filename="ws-diagnostics-'
        )
        assert res.headers["content-disposition"].endswith('.zip"')
        assert client.get(INFO, headers=auth(settings, user)).status_code == 200
        n = db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action == "system.diagnostics", AuditLog.user_id == user)
        )
        assert n == 1


def test_diagnostics_filename_pattern(client, settings):
    res = client.get(DIAG, headers=auth(settings, IT_ADMIN))
    assert re.fullmatch(
        r'attachment; filename="ws-diagnostics-\d{8}-\d{6}\.zip"',
        res.headers["content-disposition"],
    )


def test_diagnostics_masks_secrets(settings, tmp_path, engine):
    secret = "test-secret-abcdefghijklmnopqrstuvwxyz0123"
    master = "dGVzdC1tYXN0ZXIta2V5LTAxMjM0NTY3ODktMDEyMzQ="  # 32 字节
    db_pw = "pw-test-9f8e7d6c"
    s = settings.model_copy(
        update={
            "jwt_secret": secret,
            "master_key": master,
            "database_url": f"postgresql+psycopg://u:{db_pw}@db.local:5432/ws",
            "redis_url": settings.redis_url,
            "log_dir": tmp_path,
        }
    )
    configure_logging("INFO", log_dir=tmp_path)
    structlog.get_logger().info(
        "login", phone="13800000061", auth=f"Bearer {FAKE_JWT}", note=f"token={FAKE_JWT}"
    )
    data = build_bundle(engine, s, datetime.now(UTC))
    z = _zip(data)
    assert set(z.namelist()) == FILES
    needles = [secret, master, db_pw, "13800000061", FAKE_JWT, "Bearer eyJ"]
    for name in z.namelist():
        text = z.read(name).decode("utf-8")
        for needle in needles:
            assert needle not in text, f"{name} 泄露 {needle}"
    cfg = json.loads(z.read("config.json"))
    assert cfg["jwt_secret"] == "***"
    assert cfg["master_key"] == "***"
    assert cfg["database_url"] == "postgresql+psycopg://u:***@db.local:5432/ws"
    assert "1**********" in z.read("logs.jsonl").decode()


def test_diagnostics_http_masks_secrets_end_to_end(settings, db, redis_client, tmp_path, engine):
    secret = "test-secret-http-abcdefghijklmnopqrstuvwxyz"
    s = settings.model_copy(update={"jwt_secret": secret, "log_dir": tmp_path})
    app = create_app(s)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    c = TestClient(app)
    structlog.get_logger().info("x", phone="13800000061", h=f"Bearer {FAKE_JWT}")
    res = c.get(DIAG, headers=auth(s, IT_ADMIN))
    assert res.status_code == 200, res.text
    z = _zip(res.content)
    for name in z.namelist():
        text = z.read(name).decode()
        assert secret not in text
        assert "13800000061" not in text
        assert FAKE_JWT not in text
    assert json.loads(z.read("config.json"))["jwt_secret"] == "***"


def test_bundle_contents(engine, settings, db):
    z = _zip(build_bundle(engine, settings, NOW))
    assert set(z.namelist()) == FILES
    ver = json.loads(z.read("version.json"))
    assert set(ver) == {"version", "migration", "python", "postgres", "redis", "generated_at"}
    assert ver["migration"] == "0010"
    assert ver["generated_at"].startswith("2026-11-05T08:30:15")
    schema = json.loads(z.read("schema.json"))
    assert "users" in schema["tables"]
    users = schema["tables"]["users"]
    assert {"name": "login_name"}.items() <= next(
        c for c in users["columns"] if c["name"] == "login_name"
    ).items()
    assert set(users["columns"][0]) == {"name", "type", "nullable"}
    assert {"indexes", "constraints"} <= set(users)
    counts = json.loads(z.read("counts.json"))
    assert counts["students"] == db.scalar(select(func.count()).select_from(Student))
    assert counts["students"] > 0
    raw = z.read("schema.json").decode() + z.read("counts.json").decode()
    for name in db.scalars(select(Student.name)).all():
        assert name not in raw
    assert z.read("logs.jsonl") == b""


def test_bundle_redis_unavailable_is_null(engine, settings):
    s = settings.model_copy(update={"redis_url": "redis://127.0.0.1:1/0"})
    z = _zip(build_bundle(engine, s, NOW))
    assert json.loads(z.read("version.json"))["redis"] is None


def test_bundle_logs_only_recent_and_capped(engine, settings, tmp_path, monkeypatch):
    import os
    import time

    s = settings.model_copy(update={"log_dir": tmp_path})
    (tmp_path / "app.jsonl").write_text('{"event":"today"}\n')
    (tmp_path / "app.jsonl.2026-11-04").write_text('{"event":"d1"}\n')
    old = tmp_path / "app.jsonl.2026-10-01"
    old.write_text('{"event":"ancient"}\n')
    ts = time.time() - 10 * 86400
    os.utime(old, (ts, ts))
    now = datetime.now(UTC)
    logs = _zip(build_bundle(engine, s, now)).read("logs.jsonl").decode()
    assert "today" in logs and "d1" in logs and "ancient" not in logs

    monkeypatch.setattr("app.deploy.diagnostics.MAX_LOG_BYTES", 100)
    (tmp_path / "app.jsonl").write_text("".join(f'{{"event":"e{i:03d}"}}\n' for i in range(50)))
    capped = _zip(build_bundle(engine, s, now)).read("logs.jsonl")
    assert len(capped) <= 100
    assert b"e049" in capped and b"e000" not in capped
    assert capped.startswith(b"{")  # 不留半行


def test_system_info(client, settings, tmp_path):
    s = settings.model_copy(update={"log_dir": tmp_path})
    client.app.state.settings = s
    h = auth(s, IT_ADMIN)
    body = client.get(INFO, headers=h).json()
    assert body["migration"] == "0010"
    assert body["version"]
    assert body["started_at"]
    assert body["db_size_bytes"] > 0
    assert body["last_backup"] is None
    f = tmp_path / "backup-last.json"
    f.write_text(
        json.dumps(
            {"at": "2026-11-05T02:00:00Z", "file": "ws-backup-20261105.tar.gz", "size_bytes": 1234}
        )
    )
    lb = client.get(INFO, headers=h).json()["last_backup"]
    assert lb == {
        "at": "2026-11-05T02:00:00Z",
        "file": "ws-backup-20261105.tar.gz",
        "size_bytes": 1234,
    }
    for bad in ("{not json", "[]", json.dumps({"at": "x"}), "null"):
        f.write_text(bad)
        res = client.get(INFO, headers=h)
        assert res.status_code == 200
        assert res.json()["last_backup"] is None


def test_system_info_log_dir_none(client, settings):
    assert settings.log_dir is None
    res = client.get(INFO, headers=auth(settings, IT_ADMIN))
    assert res.json()["last_backup"] is None


def test_audit_extra_has_no_secrets(client, settings, db):
    client.get(DIAG, headers=auth(settings, IT_ADMIN))
    row = db.scalars(select(AuditLog).where(AuditLog.action == "system.diagnostics")).one()
    assert "secret" not in json.dumps(row.extra or {}).lower()


# ---- mask_line / mask_settings 单元 ----


def test_mask_line_phone():
    assert mask_line("call 13800000061 now") == "call 1********** now"


def test_mask_line_bearer_and_jwt():
    assert mask_line(f"Authorization: Bearer {FAKE_JWT}") == "Authorization: ***"
    assert mask_line("Bearer opaque-token_1.2") == "***"
    assert mask_line(f"t={FAKE_JWT};") == "t=***;"


def test_mask_line_multiple():
    out = mask_line(f"a 13800000061 b 13912345678 c Bearer {FAKE_JWT} d {FAKE_JWT}")
    assert out == "a 1********** b 1********** c *** d ***"


def test_mask_line_untouched():
    line = '{"event": "ok", "n": 1234567890, "id": "abc"}'
    assert mask_line(line) == line


def test_mask_line_phone_inside_longer_digits():
    # 12 位以上数字串不是手机号
    assert mask_line("id=138000000611") == "id=138000000611"


def test_mask_settings():
    s = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p%40ss@db.local:5432/ws",
        redis_url="redis://:rp@r.local:6380/2",
        jwt_secret="test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    )
    m = mask_settings(s)
    assert set(m) == set(Settings.model_fields)
    assert m["jwt_secret"] == "***"
    assert m["master_key"] == "***"
    assert m["database_url"] == "postgresql+psycopg://u:***@db.local:5432/ws"
    assert m["redis_url"] == "redis://:***@r.local:6380/2"
    assert m["log_level"] == "INFO"
    assert m["log_dir"] is None
    json.dumps(m)  # 可序列化


def test_mask_settings_url_without_password_and_none():
    s = Settings(_env_file=None, redis_url="redis://localhost:6379/0", log_dir=Path("/x"))
    m = mask_settings(s)
    assert m["redis_url"] == "redis://localhost:6379/0"
    assert m["log_dir"] == "/x"
