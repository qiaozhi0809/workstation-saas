import json
import logging
import os
import stat
import sys

import pytest
import structlog
from pydantic import ValidationError

from app.config import Settings
from app.logging import FILE_LOGGER_NAME, configure_logging


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
