import logging
import logging.handlers
import os
import sys
import threading
import time
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


class SafeTimedRotatingFileHandler(logging.handlers.TimedRotatingFileHandler):
    """多进程(app 多 worker + scheduler)同写 app.jsonl 的按天轮转。

    标准实现发现目标文件已存在会先删除再改名,后轮转的进程会把先轮转进程已归档的整天日志删掉。
    这里目标已存在时不删不覆盖,只跳过改名、重开流;并发写依赖追加模式(O_APPEND)。
    轮转按本机本地时间(utc=False);容器时区由部署设置(compose 里设 TZ),否则按 UTC 午夜轮转。
    """

    def doRollover(self) -> None:
        if self.stream:
            self.stream.close()
            self.stream = None  # type: ignore[assignment]
        current = int(time.time())
        t = self.rolloverAt - self.interval
        time_tuple = time.gmtime(t) if self.utc else time.localtime(t)
        dfn = self.rotation_filename(
            self.baseFilename + "." + time.strftime(self.suffix, time_tuple)
        )
        if not os.path.exists(dfn):
            self.rotate(self.baseFilename, dfn)
        if self.backupCount > 0:
            for old in self.getFilesToDelete():
                try:
                    os.remove(old)
                except OSError:
                    pass
        if not self.delay:
            self.stream = self._open()
        new_at = self.computeRollover(current)
        while new_at <= current:
            new_at += self.interval
        if not self.utc:
            dst_now = time.localtime(current)[-1]
            dst_at = time.localtime(new_at)[-1]
            if dst_now != dst_at:
                new_at += -3600 if not dst_now else 3600
        self.rolloverAt = new_at


def _file_logger(log_dir: Path, retention_days: int) -> logging.Logger | None:
    logger = logging.getLogger(FILE_LOGGER_NAME)
    for h in list(logger.handlers):  # 重复 configure 不叠加
        logger.removeHandler(h)
        h.close()
    logger.propagate = False
    logger.setLevel(logging.INFO)
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = SafeTimedRotatingFileHandler(
            log_dir / LOG_FILE_NAME,
            when="midnight",
            backupCount=retention_days,
            encoding="utf-8",
            utc=False,
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
