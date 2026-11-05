import logging
import logging.handlers
import sys
import threading
from pathlib import Path
from typing import TextIO

import structlog

FILE_LOGGER_NAME = "app.logfile"
LOG_FILE_NAME = "app.jsonl"


class _Tee:
    """PrintLogger 的输出流:原样写 stdout,并把每个完整行交给文件 handler。"""

    def __init__(self, stream: TextIO, file_logger: logging.Logger | None):
        self._stream = stream
        self._file_logger = file_logger
        self._buf = ""
        self._lock = threading.Lock()

    def write(self, data: str) -> int:
        self._stream.write(data)
        if self._file_logger is not None:
            with self._lock:
                self._buf += data
                *lines, self._buf = self._buf.split("\n")
            for line in lines:
                if line:
                    self._file_logger.info(line)
        return len(data)

    def flush(self) -> None:
        self._stream.flush()


def _file_logger(log_dir: Path, retention_days: int) -> logging.Logger | None:
    logger = logging.getLogger(FILE_LOGGER_NAME)
    for h in list(logger.handlers):  # 重复 configure 不叠加
        logger.removeHandler(h)
        h.close()
    logger.propagate = False
    logger.setLevel(logging.INFO)
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.TimedRotatingFileHandler(
            log_dir / LOG_FILE_NAME,
            when="midnight",
            backupCount=retention_days,
            encoding="utf-8",
            utc=True,
        )
    except OSError:
        return None
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    return logger


def configure_logging(level: str, log_dir: Path | None = None, retention_days: int = 14) -> None:
    """Configure structlog to emit JSON lines to stdout (and app.jsonl if log_dir is given).

    Safe to call repeatedly.
    """
    log_level = logging.getLevelNamesMapping().get(level.upper(), logging.INFO)
    file_logger: logging.Logger | None = None
    file_failed = False
    if log_dir is None:
        _file_logger_off()
    else:
        file_logger = _file_logger(log_dir, retention_days)
        file_failed = file_logger is None
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.PrintLoggerFactory(file=_Tee(sys.stdout, file_logger)),
        cache_logger_on_first_use=False,
    )
    if file_failed:
        structlog.get_logger().warning("log_dir_unavailable", log_dir=str(log_dir))


def _file_logger_off() -> None:
    logger = logging.getLogger(FILE_LOGGER_NAME)
    for h in list(logger.handlers):
        logger.removeHandler(h)
        h.close()
