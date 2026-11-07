import json
import logging
import os
import stat
import sys
import time

import pytest
import structlog
from pydantic import ValidationError

from app.config import Settings
from app.logging import FILE_LOGGER_NAME, SafeTimedRotatingFileHandler, configure_logging


@pytest.fixture(autouse=True)
def _restore_logging():
    yield
    configure_logging("INFO")


def test_file_sink(tmp_path, capsys):
    configure_logging("INFO", log_dir=tmp_path)
    structlog.get_logger().info("hello", who="tester")
    out = capsys.readouterr().out.strip().splitlines()[-1]
    lines = (tmp_path / "app.jsonl").read_text(encoding="utf-8").splitlines()
    assert lines == [out]
    assert json.loads(lines[0])["event"] == "hello"


def test_log_retention_days_validated():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, log_retention_days=5)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, log_retention_days=31)
    assert Settings(_env_file=None, log_retention_days=7).log_retention_days == 7
    assert Settings(_env_file=None).log_dir is None


def test_reconfigure_does_not_duplicate_handlers(tmp_path):
    for _ in range(3):
        configure_logging("INFO", log_dir=tmp_path)
    assert len(logging.getLogger(FILE_LOGGER_NAME).handlers) == 1
    structlog.get_logger().info("once")
    assert len((tmp_path / "app.jsonl").read_text().splitlines()) == 1


def test_retention_and_rotation_config(tmp_path):
    configure_logging("INFO", log_dir=tmp_path, retention_days=9)
    (handler,) = logging.getLogger(FILE_LOGGER_NAME).handlers
    assert handler.backupCount == 9
    assert handler.when == "MIDNIGHT"


def test_creates_missing_log_dir(tmp_path):
    target = tmp_path / "a" / "b"
    configure_logging("INFO", log_dir=target)
    structlog.get_logger().info("x")
    assert (target / "app.jsonl").exists()


@pytest.mark.skipif(os.geteuid() == 0, reason="root 不受目录权限限制")
def test_unwritable_dir_falls_back_to_stdout(tmp_path, capsys):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        configure_logging("INFO", log_dir=locked / "sub")
        structlog.get_logger().info("still-works")
    finally:
        locked.chmod(stat.S_IRWXU)
    out = capsys.readouterr().out
    assert "still-works" in out
    assert "log_dir_unavailable" in out
    assert not logging.getLogger(FILE_LOGGER_NAME).handlers
    assert sys.stdout  # 应用仍可启动


def test_rollover_never_overwrites_existing_target(tmp_path):
    path = tmp_path / "app.jsonl"
    h = SafeTimedRotatingFileHandler(path, when="midnight", backupCount=3, utc=False)
    try:
        h.stream.write("current-line\n")
        h.stream.flush()
        h.rolloverAt = int(time.time()) - 1
        t = h.rolloverAt - h.interval
        dfn = tmp_path / ("app.jsonl." + time.strftime(h.suffix, time.localtime(t)))
        dfn.write_text("other-process-rolled\n")  # 另一进程已轮转出的当天文件
        h.doRollover()
        assert dfn.read_text() == "other-process-rolled\n"
        assert "current-line" in path.read_text()  # 本进程内容没丢
        h.stream.write("after\n")
        h.stream.flush()
        assert path.read_text().endswith("after\n")
        assert h.rolloverAt > time.time()
    finally:
        h.close()


def test_rollover_renames_when_target_absent(tmp_path):
    path = tmp_path / "app.jsonl"
    h = SafeTimedRotatingFileHandler(path, when="midnight", backupCount=3, utc=False)
    try:
        h.stream.write("old\n")
        h.stream.flush()
        h.rolloverAt = int(time.time()) - 1
        t = h.rolloverAt - h.interval
        dfn = tmp_path / ("app.jsonl." + time.strftime(h.suffix, time.localtime(t)))
        h.doRollover()
        assert dfn.read_text() == "old\n"
        assert path.read_text() == ""
    finally:
        h.close()


def test_handler_uses_local_time_and_safe_class(tmp_path):
    configure_logging("INFO", log_dir=tmp_path)
    (handler,) = logging.getLogger(FILE_LOGGER_NAME).handlers
    assert isinstance(handler, SafeTimedRotatingFileHandler)
    assert handler.utc is False


def test_scheduler_command_logs_to_file(tmp_path, monkeypatch):
    import app.cli as cli
    from app.deploy import scheduler

    s = Settings(_env_file=None, log_dir=tmp_path, log_retention_days=9)
    monkeypatch.setattr(cli, "get_settings", lambda: s)
    monkeypatch.setattr(scheduler, "serve", lambda settings: None)
    monkeypatch.setattr(sys, "argv", ["cli", "scheduler"])
    with pytest.raises(SystemExit) as ei:
        cli.main()
    assert ei.value.code == 0
    (handler,) = logging.getLogger(FILE_LOGGER_NAME).handlers
    assert handler.backupCount == 9
    structlog.get_logger().info("from-scheduler")
    # scheduler 用单独文件名,避免和 app 多 worker 同写一个文件的轮转冲突
    assert "from-scheduler" in (tmp_path / "scheduler.jsonl").read_text()
    assert not (tmp_path / "app.jsonl").exists()


def test_file_name_parameter(tmp_path):
    configure_logging("INFO", log_dir=tmp_path, file_name="other.jsonl")
    structlog.get_logger().info("x")
    assert (tmp_path / "other.jsonl").exists()
    assert not (tmp_path / "app.jsonl").exists()


def test_create_app_logs_started_event(tmp_path):
    from app.main import create_app
    from app.version import APP_VERSION

    s = Settings(_env_file=None, log_dir=tmp_path)
    create_app(s)
    lines = [json.loads(ln) for ln in (tmp_path / "app.jsonl").read_text().splitlines()]
    started = [e for e in lines if e["event"] == "app.started"]
    assert len(started) == 1
    assert started[0]["version"] == APP_VERSION and started[0]["env"] == s.env
    blob = json.dumps(started[0])
    assert s.jwt_secret not in blob and s.master_key not in blob and "postgresql" not in blob


def test_uvicorn_log_config_emits_json_with_exception(capsys):
    import logging.config
    from pathlib import Path

    import app

    cfg = json.loads((Path(app.__file__).parent / "uvicorn-log.json").read_text(encoding="utf-8"))
    logging.config.dictConfig(cfg)
    log = logging.getLogger("uvicorn.error")
    log.info("Started parent process [1]")
    try:
        raise ValueError("boom")
    except ValueError:
        log.exception("failed")
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 2
    first, second = (json.loads(x) for x in lines)
    assert first["logger"] == "uvicorn.error" and first["level"] == "info"
    assert "ValueError: boom" in second["exception"]
