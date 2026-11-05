"""诊断包:版本、打码后的配置、库结构(不含数据)、各表行数、近 3 天日志。

安全:密钥、库/Redis 密码、手机号、令牌不得出现在包里(Global Constraints "密钥")。
"""

import io
import json
import platform
import re
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, inspect, text

from app.config import Settings
from app.version import APP_VERSION

MASK = "***"
MAX_LOG_BYTES = 20 * 1024 * 1024
LOG_DAYS = 3
LOG_FILE_PREFIX = "app.jsonl"

_SENSITIVE_KEY = re.compile(r"secret|key|password|token", re.IGNORECASE)
# DSN:`://` 之后第一个 `:` 起,到同一串里最后一个 `@` 之前全部是密码(可含 / @ ?)
_URL_PASSWORD = re.compile(r"(://[^:/@\s\"'\\]*:)[^\s\"'\\]*@")
_PHONE = re.compile(r"(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)")
_BEARER = re.compile(r"Bearer\s+[A-Za-z0-9._~+/=\-]+", re.IGNORECASE)
_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*")
_BCRYPT = re.compile(r"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}")
_API_KEY = re.compile(r"sk-[A-Za-z0-9_\-]{16,}")
# SQLAlchemy 异常里的 [parameters: (...)] 带真实列值(姓名、哈希……),整段抹掉;贪婪到最后一个 ]
_SQL_PARAMS = re.compile(r"\[parameters: .*\]")
# JSON 日志里 "xxx_password": "值" 之类的键值(值里可含转义引号)
_JSON_SECRET = re.compile(
    r'("[\w\-]*(?:secret|password|passwd|token|api_?key|master_?key)[\w\-]*"\s*:\s*")'
    r'(?:[^"\\]|\\.)*(")',
    re.IGNORECASE,
)


def mask_url(value: str) -> str:
    return _URL_PASSWORD.sub(rf"\1{MASK}@", value)


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, list | tuple | set):
        return [_jsonable(v) for v in value]
    return str(value)


def mask_settings(settings: Settings) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in type(settings).model_fields:
        value = getattr(settings, name)
        if value is None:
            out[name] = None
        elif _SENSITIVE_KEY.search(name):
            out[name] = MASK
        else:
            v = _jsonable(value)
            out[name] = mask_url(v) if isinstance(v, str) and "://" in v else v
    return out


def mask_line(line: str) -> str:
    line = _SQL_PARAMS.sub(f"[parameters: {MASK}]", line)
    line = mask_url(line)
    line = _JSON_SECRET.sub(rf"\1{MASK}\2", line)
    line = _BCRYPT.sub(MASK, line)
    line = _API_KEY.sub(MASK, line)
    line = _BEARER.sub(MASK, line)
    line = _JWT.sub(MASK, line)
    return _PHONE.sub("1**********", line)


def current_revision(conn: Any) -> str | None:
    """alembic 当前版本(如 "0010");库里没有 alembic_version 时为 None。"""
    if not conn.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL")).scalar_one():
        return None
    return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def _schema(engine: Engine) -> dict[str, Any]:
    insp = inspect(engine)
    tables: dict[str, Any] = {}
    for name in sorted(insp.get_table_names()):
        pk = insp.get_pk_constraint(name)
        tables[name] = {
            "columns": [
                {"name": c["name"], "type": str(c["type"]), "nullable": bool(c["nullable"])}
                for c in insp.get_columns(name)
            ],
            "indexes": [
                {
                    "name": i["name"],
                    "columns": [c for c in i["column_names"] if c is not None],
                    "unique": bool(i.get("unique")),
                }
                for i in insp.get_indexes(name)
            ],
            "constraints": {
                "primary_key": {"name": pk.get("name"), "columns": pk.get("constrained_columns")},
                "unique": [
                    {"name": u["name"], "columns": u["column_names"]}
                    for u in insp.get_unique_constraints(name)
                ],
                "foreign_keys": [
                    {
                        "name": f["name"],
                        "columns": f["constrained_columns"],
                        "referred_table": f["referred_table"],
                        "referred_columns": f["referred_columns"],
                    }
                    for f in insp.get_foreign_keys(name)
                ],
                "check": [
                    {"name": c["name"], "sqltext": c["sqltext"]}
                    for c in insp.get_check_constraints(name)
                ],
            },
        }
    return {"tables": tables}


COUNT_TIMEOUT = "5s"


def _count_query(quoted_table: str) -> str:
    return f"SELECT count(*) FROM {quoted_table}"


def _counts(engine: Engine) -> dict[str, int | None]:
    """每表行数;单表超时(statement_timeout)或出错记 null,不让整包失败。"""
    quote = engine.dialect.identifier_preparer.quote
    names = sorted(inspect(engine).get_table_names())
    out: dict[str, int | None] = {}
    for n in names:
        try:
            with engine.connect() as conn, conn.begin():
                conn.execute(text(f"SET LOCAL statement_timeout = '{COUNT_TIMEOUT}'"))
                out[n] = conn.execute(text(_count_query(quote(n)))).scalar_one()
        except Exception:
            out[n] = None
    return out


def _redis_version(redis_url: str) -> str | None:
    try:
        from redis import Redis

        client = Redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
        try:
            return str(client.info("server")["redis_version"])
        finally:
            client.close()
    except Exception:
        return None


def _log_files(log_dir: Path, since: datetime) -> list[Path]:
    """最近 LOG_DAYS 天有改动的应用日志(含轮转文件),由新到旧。"""
    cutoff = since.timestamp()
    found = []
    for p in log_dir.glob(f"{LOG_FILE_PREFIX}*"):
        try:
            if p.is_file() and p.stat().st_mtime >= cutoff:
                found.append((p.stat().st_mtime, p))
        except OSError:
            continue
    return [p for _, p in sorted(found, key=lambda t: t[0], reverse=True)]


def _tail_lines(path: Path) -> list[str]:
    """文件最后 MAX_LOG_BYTES 字节内的完整行(截断点处的残行丢弃)。"""
    with path.open("rb") as fh:
        size = fh.seek(0, 2)
        start = max(0, size - MAX_LOG_BYTES)
        fh.seek(start)
        data = fh.read(MAX_LOG_BYTES)
    lines = data.split(b"\n")
    if start > 0:
        lines = lines[1:]
    return [ln.decode("utf-8", errors="replace") for ln in lines if ln]


def _masked_lines_newest_first(files: list[Path]) -> Iterator[bytes]:
    for p in files:
        try:
            lines = _tail_lines(p)
        except OSError:
            continue
        for ln in reversed(lines):
            yield (mask_line(ln) + "\n").encode("utf-8")


def collect_logs(log_dir: Path | None, now: datetime) -> bytes:
    if log_dir is None or not log_dir.is_dir():
        return b""
    kept: list[bytes] = []
    total = 0
    for line in _masked_lines_newest_first(_log_files(log_dir, now - timedelta(days=LOG_DAYS))):
        total += len(line)
        if total > MAX_LOG_BYTES:
            break
        kept.append(line)
    return b"".join(reversed(kept))


def _dump(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def build_bundle(engine: Engine, settings: Settings, now: datetime) -> bytes:
    now = now.astimezone(UTC)
    with engine.connect() as conn:
        postgres = conn.execute(text("SHOW server_version")).scalar_one()
        migration = current_revision(conn)
    version = {
        "version": APP_VERSION,
        "migration": migration,
        "python": platform.python_version(),
        "postgres": postgres,
        "redis": _redis_version(settings.redis_url),
        "generated_at": now.isoformat(),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("version.json", _dump(version))
        z.writestr("config.json", _dump(mask_settings(settings)))
        z.writestr("schema.json", _dump(_schema(engine)))
        z.writestr("counts.json", _dump(_counts(engine)))
        z.writestr("logs.jsonl", collect_logs(settings.log_dir, now))
    return buf.getvalue()
