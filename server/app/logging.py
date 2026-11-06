import logging
import logging.handlers
import os
import sys
import threading
import time
from pathlib import Path
from typing import TextIO

import structlog

from app.deploy.diagnostics import mask_url

FILE_LOGGER_NAME = "app.logfile"
LOG_FILE_NAME = "app.jsonl"
# uvicorn 自己用 dictConfig 给这几个 logger 装了 handler 且 propagate=False;
# 接管后它们走 root → 本模块的 JSON 链
_STDLIB_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")
_STDLIB_HANDLER_MARK = "_ws_stdlib_handler"


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

    def _archive(self, dfn: str) -> None:
        """硬链接归档:目标已存在则 FileExistsError,跳过(不覆盖);成功后再删原名。
        不用 exists()+rename,避免两步之间被别的进程抢先创建而覆盖。"""
        try:
            os.link(self.baseFilename, dfn)
        except FileExistsError:
            return
        except OSError:  # 文件系统不支持硬链接等:退回普通改名,仍不覆盖已有文件
            if not os.path.exists(dfn):
                self.rotate(self.baseFilename, dfn)
            return
        try:
            os.remove(self.baseFilename)
        except FileNotFoundError:
            pass

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
        self._archive(dfn)
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


def _file_logger(log_dir: Path, retention_days: int, file_name: str) -> logging.Logger | None:
    logger = logging.getLogger(FILE_LOGGER_NAME)
    for h in list(logger.handlers):  # 重复 configure 不叠加
        logger.removeHandler(h)
        h.close()
    logger.propagate = False
    logger.setLevel(logging.INFO)
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = SafeTimedRotatingFileHandler(
            log_dir / file_name,
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


def _mask_stdlib_event(_logger: object, _name: str, event_dict: dict) -> dict:
    """stdlib 记录(主要是 uvicorn 访问日志)落盘前对 URL 打码(L158):连接串里的密码,以及查询串里的
    u= / sig= / token= 等值。只处理文本字段,其余保持原样。"""
    for key in ("event", "exception"):
        value = event_dict.get(key)
        if isinstance(value, str):
            event_dict[key] = mask_url(value)
    return event_dict


def _attach_stdlib(tee: _Tee, log_level: int) -> None:
    """把 stdlib 的 root 与 uvicorn.* logger 接进同一条 JSON 链(L111)。

    每条记录一行 JSON,带 logger 名、级别、UTC 时间戳,写到 stdout 与 app.jsonl(经同一个 _Tee)。
    只替换本模块上次装的 handler,不碰别人的(如 pytest 的)。
    app.logfile 这个 logger 不向 root 传播,文件 handler 不会把自己的输出再喂回来。
    """
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=[
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            _mask_stdlib_event,
        ],
    )
    handler = logging.StreamHandler(tee)
    handler.setFormatter(formatter)
    setattr(handler, _STDLIB_HANDLER_MARK, True)
    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, _STDLIB_HANDLER_MARK, False):
            root.removeHandler(h)
            h.close()
    root.addHandler(handler)
    root.setLevel(log_level)
    for name in _STDLIB_LOGGERS:
        lg = logging.getLogger(name)
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.propagate = True
        lg.setLevel(logging.NOTSET)


def configure_logging(
    level: str,
    log_dir: Path | None = None,
    retention_days: int = 14,
    file_name: str = LOG_FILE_NAME,
) -> None:
    """Configure structlog to emit JSON lines to stdout (and app.jsonl if log_dir is given).

    stdlib root 与 uvicorn.* 的记录也走同一条链(L111),uvicorn 访问日志里的查询串经 mask_url
    打码(L158)。Safe to call repeatedly.
    """
    log_level = logging.getLevelNamesMapping().get(level.upper(), logging.INFO)
    file_logger: logging.Logger | None = None
    file_failed = False
    if log_dir is None:
        _file_logger_off()
    else:
        file_logger = _file_logger(log_dir, retention_days, file_name)
        file_failed = file_logger is None
    tee = _Tee(sys.stdout, file_logger)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.PrintLoggerFactory(file=tee),
        cache_logger_on_first_use=False,
    )
    _attach_stdlib(tee, log_level)
    if file_failed:
        structlog.get_logger().warning("log_dir_unavailable", log_dir=str(log_dir))


def _file_logger_off() -> None:
    logger = logging.getLogger(FILE_LOGGER_NAME)
    for h in list(logger.handlers):
        logger.removeHandler(h)
        h.close()
