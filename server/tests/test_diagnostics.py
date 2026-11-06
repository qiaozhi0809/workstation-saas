import io
import json
import logging
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
import structlog
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.config import Settings
from app.db import get_db
from app.deploy.diagnostics import build_bundle, mask_line, mask_settings
from app.deploy.precheck import head_revision
from app.logging import configure_logging
from app.main import create_app
from app.models import Student, User
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
    # 证明 create_app 把 log_dir 接上了、日志真的落盘并被打码
    assert "1**********" in z.read("logs.jsonl").decode()


def test_bundle_contents(engine, settings, db):
    z = _zip(build_bundle(engine, settings, NOW))
    assert set(z.namelist()) == FILES
    ver = json.loads(z.read("version.json"))
    assert set(ver) == {"version", "migration", "python", "postgres", "redis", "generated_at"}
    assert ver["migration"] == head_revision(engine)
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


def test_system_info(client, settings, tmp_path, engine):
    s = settings.model_copy(update={"log_dir": tmp_path})
    client.app.state.settings = s
    h = auth(s, IT_ADMIN)
    body = client.get(INFO, headers=h).json()
    assert body["migration"] == head_revision(engine)
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
    out = mask_line(f"a 13800000061 b 13800000062 c Bearer {FAKE_JWT} d {FAKE_JWT}")
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


# ---- 加固(评审 H1/H2/M1-M5) ----

BCRYPT = "$2b$12$" + "aB3./" * 10 + "xyz"  # 7 + 53 字符
assert len(BCRYPT) == 60


def test_mask_line_h1_sql_parameters_traceback():
    line = json.dumps(
        {
            "event": "db error",
            "exception": "Traceback ... sqlalchemy.exc.IntegrityError: ... "
            "[SQL: INSERT INTO users (display_name, password_hash) VALUES (%(a)s, %(b)s)]\n"
            f"[parameters: ('张三测试', '{BCRYPT}', {{'k': ['李]四测试']}})]\n"
            "(Background on this error at: https://sqlalche.me/e/20/gkpj)",
        },
        ensure_ascii=False,
    )
    out = mask_line(line)
    assert "张三测试" not in out and "李]四测试" not in out
    assert BCRYPT not in out and "aB3./" not in out
    assert "[parameters: ***]" in out
    assert "[SQL: INSERT INTO users" in out  # SQL 本身保留,便于排障


def test_mask_line_h1_bcrypt_and_sk_key():
    assert mask_line(f"hash={BCRYPT};") == "hash=***;"
    assert mask_line("key sk-ABCDEFGHIJKLMNOP_qrst-1234 end") == "key *** end"
    assert mask_line("sk-short") == "sk-short"


def test_diagnostics_h1_traceback_not_in_any_file(engine, settings, tmp_path):
    s = settings.model_copy(update={"log_dir": tmp_path})
    (tmp_path / "app.jsonl").write_text(
        f"[SQL: x] [parameters: ('张三测试', '{BCRYPT}', 1)]\n", encoding="utf-8"
    )
    z = _zip(build_bundle(engine, s, datetime.now(UTC)))
    for name in z.namelist():
        text = z.read(name).decode()
        assert "张三测试" not in text and BCRYPT not in text


@pytest.mark.parametrize(
    "raw",
    [
        "13800000061",
        "+8613800000061",
        "8613800000061",
        "+86 13800000061",
        "138-0000-0061",
        "138 0000 0061",
        "+86-138-0000-0061",
    ],
)
def test_mask_line_h2_phone_variants(raw):
    assert mask_line(f"tel {raw} ok") == "tel 1********** ok"


@pytest.mark.parametrize("raw", ["138000000611", "1380000006112345", "123456789012", "21380000061"])
def test_mask_line_h2_no_false_positive(raw):
    assert mask_line(f"n={raw}") == f"n={raw}"


def test_mask_url_m1_special_password():
    s = Settings(
        _env_file=None,
        redis_url="redis://:p/w@host:6379/0",
        database_url="postgresql+psycopg://u:p@ss@h/db",
    )
    m = mask_settings(s)
    assert m["redis_url"] == "redis://:***@host:6379/0"
    assert m["database_url"] == "postgresql+psycopg://u:***@h/db"
    assert "p/w" not in json.dumps(m) and "p@ss" not in json.dumps(m)


def test_mask_line_m1_dsn_in_json_and_text():
    line = json.dumps({"dsn": "postgresql://u:pw?x@h:5432/db", "e": "redis://:p/w@r:6379/0\nnext"})
    out = mask_line(line)
    assert "pw?x" not in out and "p/w" not in out
    assert "postgresql://u:***@h:5432/db" in out and "redis://:***@r:6379/0" in out
    assert "@h:5432/db" in out  # host 保留


def test_mask_line_m2_json_secret_with_escaped_quote():
    line = json.dumps({"password": 'a"bc', "n": 1})
    out = mask_line(line)
    assert "bc" not in out.replace("abc", "")  # 密码尾巴不残留
    assert json.loads(out) == {"password": "***", "n": 1}


def test_zip_no_store(client, settings):
    res = client.get(DIAG, headers=auth(settings, IT_ADMIN))
    assert res.headers["cache-control"] == "no-store"


def test_failed_bundle_is_audited(client, settings, db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.deploy.system_router.build_bundle", boom)
    c = TestClient(client.app, raise_server_exceptions=False)
    res = c.get(DIAG, headers=auth(settings, IT_ADMIN))
    assert res.status_code == 500
    row = db.scalars(select(AuditLog).where(AuditLog.action == "system.diagnostics")).one()
    assert row.success is False
    assert "boom" not in json.dumps(row.extra or {})


def test_log_tail_only_last_chunk_read(engine, settings, tmp_path, monkeypatch):
    monkeypatch.setattr("app.deploy.diagnostics.MAX_LOG_BYTES", 100)
    s = settings.model_copy(update={"log_dir": tmp_path})
    (tmp_path / "app.jsonl").write_text("".join(f'{{"event":"e{i:03d}"}}\n' for i in range(50)))
    seen = []
    import builtins

    real_open = builtins.open
    # 文件内容超过上限时,只读尾部:断言实际读取的字节数不超过上限 + 一行
    import pathlib

    orig = pathlib.Path.open

    def spy(self, *a, **k):
        f = orig(self, *a, **k)
        if self.name == "app.jsonl":
            orig_read = f.read

            def read(n=-1):
                data = orig_read(n)
                seen.append(len(data))
                return data

            f.read = read
        return f

    monkeypatch.setattr(pathlib.Path, "open", spy)
    out = _zip(build_bundle(engine, s, datetime.now(UTC))).read("logs.jsonl")
    assert real_open
    assert b"e049" in out and b"e000" not in out and out.startswith(b"{")
    assert seen and max(seen) <= 100


def test_counts_timeout_gives_null(engine, settings, monkeypatch):
    monkeypatch.setattr("app.deploy.diagnostics.COUNT_TIMEOUT", "50ms")
    monkeypatch.setattr(
        "app.deploy.diagnostics._count_query",
        lambda q: f"SELECT count(*) + (SELECT 0 FROM pg_sleep(0.5)) FROM {q}",
    )
    z = _zip(build_bundle(engine, settings, NOW))
    counts = json.loads(z.read("counts.json"))
    assert counts["students"] is None
    assert set(z.namelist()) == FILES


def test_must_change_password_gets_403(client, settings, db):
    db.execute(update(User).where(User.id == IT_ADMIN).values(must_change_password=True))
    db.flush()
    for url in (INFO, DIAG):
        res = client.get(url, headers=auth(settings, IT_ADMIN))
        assert res.status_code == 403
        assert (
            res.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
            if "error" in res.json()
            else True
        )


# ---- 终审:URL 打码绕过与通用键值规则 ----


def test_mask_url_password_with_space_quote_backslash():
    s = Settings(_env_file=None, database_url='postgresql+psycopg://u:p ss"w\\d@h/db')
    m = mask_settings(s)
    assert m["database_url"] == "postgresql+psycopg://u:***@h/db"
    out = mask_line('dsn=postgresql://u:p ss"w\\d@h:5432/db end')
    assert "p ss" not in out and "w\\d" not in out and "@h:5432/db" in out


def test_mask_url_query_password():
    s = Settings(_env_file=None, database_url="postgresql+psycopg://u@h/db?password=SEKRET1")
    assert "SEKRET1" not in json.dumps(mask_settings(s))
    for line in (
        "url postgresql+psycopg://u@h/db?password=SEKRET1&sslmode=require x",
        "redis://h:6379/0?token=SEKRET1",
        "http://h/x?api_key=SEKRET1&a=1",
    ):
        out = mask_line(line)
        assert "SEKRET1" not in out
    assert "sslmode=require" in mask_line("postgresql://u@h/db?password=S&sslmode=require")


def test_mask_settings_unparseable_url_is_fully_masked():
    s = Settings(_env_file=None, redis_url="not a url ://u:p@ss")
    assert mask_settings(s)["redis_url"] == "***"


GENERIC_CASES = [
    (json.dumps({"body": '{"password": "X-nested-1"}'}), "X-nested-1"),
    ("{'password': 'X-repr-2'}", "X-repr-2"),
    ("login failed password=X-text-3 for u", "X-text-3"),
    ("GET /x?token=X-query-4&a=1", "X-query-4"),
    ('{"pwd": "X-pwd-5"}', "X-pwd-5"),
    ('{"authorization": "Basic X-basic-6"}', "X-basic-6"),
    ("Authorization: Basic X-basic-7==", "X-basic-7"),
    ('{"cookie": "sid=X-cookie-8; a=b"}', "X-cookie-8"),
    ('{"key": "X-key-9"}', "X-key-9"),
    ('{"ai_key": "X-aikey-10"}', "X-aikey-10"),
    ('{"x-api-key": "X-apikey-11"}', "X-apikey-11"),
    ('{"password": ["X-list-12", "b"]}', "X-list-12"),
    ('{"token": {"a": "X-obj-13"}}', "X-obj-13"),
    ("input_value={'master_key': 'X-mk-14'}", "X-mk-14"),
    ("Cookie: sid=X-cookie-15; other=1", "X-cookie-15"),
    ('{"Password": "X-case-16"}', "X-case-16"),
]


@pytest.mark.parametrize(("line", "secret"), GENERIC_CASES)
def test_mask_line_generic_key_rule(line, secret):
    assert secret not in mask_line(line)


def test_mask_line_generic_keeps_json_valid_and_other_fields():
    out = mask_line(json.dumps({"event": "x", "password": "a b", "user": "bob"}))
    assert json.loads(out) == {"event": "x", "password": "***", "user": "bob"}
    nested = json.loads(mask_line(json.dumps({"body": '{"password": "P", "n": 1}'})))
    assert json.loads(nested["body"]) == {"password": "***", "n": 1}


def test_mask_line_generic_no_false_positive():
    for line in ("monkey=banana", "keyboard: qwerty", '{"event": "ok", "n": 1}'):
        assert mask_line(line) == line


# ---- stdlib / uvicorn 日志进 app.jsonl 并打码(L111 / L158) ----


def _jsonl_lines(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln]


def test_uvicorn_access_log_goes_to_app_jsonl_masked(tmp_path, capsys):
    configure_logging("INFO", log_dir=tmp_path)
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d',
        "172.30.0.3:51234",
        "GET",
        "/api/v1/stream/seg-0001.ts?u=42&sig=SIGVALUE-xyz&token=TOK-abc&n=1",
        "1.1",
        200,
    )
    text = (tmp_path / "app.jsonl").read_text(encoding="utf-8")
    assert "SIGVALUE-xyz" not in text and "TOK-abc" not in text and "u=42" not in text
    rows = _jsonl_lines(tmp_path / "app.jsonl")
    row = next(r for r in rows if r.get("logger") == "uvicorn.access")
    assert row["level"] == "info"
    assert row["event"].startswith(
        '172.30.0.3:51234 - "GET /api/v1/stream/seg-0001.ts?u=***&sig=***&token=***&n=1'
    )
    assert row["timestamp"].endswith("Z")
    # stdout 也是同一条 JSON(docker logs 看到的),不会再有 uvicorn 自己的那行
    out = capsys.readouterr().out
    assert out.count("uvicorn.access") == 1
    assert "SIGVALUE-xyz" not in out


def test_stdlib_root_logger_goes_to_app_jsonl(tmp_path):
    configure_logging("INFO", log_dir=tmp_path)
    logging.getLogger("some.library").warning("upstream http://u:pw-secret@h/x?api_key=K1 failed")
    logging.getLogger("some.library").debug("not at info level")
    try:
        raise ValueError("boom-detail")
    except ValueError:
        logging.getLogger("uvicorn.error").exception("handler crashed")
    rows = _jsonl_lines(tmp_path / "app.jsonl")
    warn = next(r for r in rows if r.get("logger") == "some.library")
    assert warn["level"] == "warning"
    assert "pw-secret" not in warn["event"] and "K1" not in warn["event"]
    assert "http://u:***@h/x?api_key=***" in warn["event"]
    assert not any(r.get("event") == "not at info level" for r in rows)
    err = next(r for r in rows if r.get("logger") == "uvicorn.error")
    assert err["level"] == "error" and "ValueError" in err["exception"]


def test_structlog_and_stdlib_share_file_without_duplicates(tmp_path):
    configure_logging("INFO", log_dir=tmp_path)
    structlog.get_logger().info("structlog.event", k=1)
    logging.getLogger("uvicorn.access").info("plain access line")
    rows = _jsonl_lines(tmp_path / "app.jsonl")
    assert [r["event"] for r in rows] == ["structlog.event", "plain access line"]
    assert rows[0]["k"] == 1 and "logger" not in rows[0]
    # 重复 configure 不叠加 handler:再记一条只出现一次
    configure_logging("INFO", log_dir=tmp_path)
    logging.getLogger("uvicorn.access").info("second line")
    rows = _jsonl_lines(tmp_path / "app.jsonl")
    assert [r["event"] for r in rows].count("second line") == 1


def test_mask_url_masks_stream_signature_params():
    from app.deploy.diagnostics import mask_url

    out = mask_url("/api/v1/stream/x.ts?u=42&sig=S1&exp=5&token=T1")
    assert out == "/api/v1/stream/x.ts?u=***&sig=***&exp=5&token=***"
    # 不误伤:u / sig 只按整个键名匹配
    assert mask_url("/x?user=42&signal=1&unit=3") == "/x?user=42&signal=1&unit=3"


def test_bundle_includes_all_jsonl_files_masked(engine, settings, tmp_path):
    s = settings.model_copy(update={"log_dir": tmp_path})
    (tmp_path / "app.jsonl").write_text('{"event":"a","p":"13800000061"}\n')
    (tmp_path / "scheduler.jsonl").write_text('{"event":"s","p":"13800000062"}\n')
    (tmp_path / "scheduler.jsonl.2026-11-04").write_text('{"event":"s-old","password":"PW-xyz"}\n')
    (tmp_path / "backup-last.json").write_text('{"file":"x"}')
    (tmp_path / "other.txt").write_text("not-a-log\n")
    logs = _zip(build_bundle(engine, s, datetime.now(UTC))).read("logs.jsonl").decode()
    assert '"event":"a"' in logs and '"event":"s"' in logs and "s-old" in logs
    for raw in ("13800000061", "13800000062", "PW-xyz"):
        assert raw not in logs
    assert "not-a-log" not in logs and '"file":"x"' not in logs
