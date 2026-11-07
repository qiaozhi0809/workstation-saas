"""常驻定时任务:每天学校本地时间到点执行一次(M5a 只有家长归档)。

上次运行日期存 Redis(`ws:job:last:<name>`),重启不会重跑也不会漏跑;
执行前先抢 `ws:job:lock:<name>`,多个实例同时在跑也只有一个执行。
日志每次一行 JSON,只写任务名、状态、摘要和异常类型,不写异常消息。
"""

import contextvars
import signal
import threading
import time as _time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID

import structlog
from redis import Redis
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session, sessionmaker

from app.clock import utc_now
from app.config import Settings, get_settings
from app.domain.parents import lifecycle
from app.domain.schools.service import school_tz
from app.models import LoginLog, School

log = structlog.get_logger()

LAST_KEY = "ws:job:last:{name}"
LOCK_KEY = "ws:job:lock:{name}"
LOCK_TTL = 600
NO_SCHOOL_WARN_EVERY = 3600.0
_NO_SCHOOL_WARNED: dict[str, float] = {}
_RELEASE = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
)
_school: contextvars.ContextVar[UUID] = contextvars.ContextVar("scheduler_school")


@dataclass(frozen=True)
class Job:
    name: str
    at: time  # 学校本地时间
    run: Callable[[Session, Redis, datetime], str]


def _parent_archive(db: Session, redis: Redis, now: datetime) -> str:
    res = lifecycle.archive_expired(db, _school.get(), now, redis, dry_run=False, via="scheduler")
    return f"archived links={res.links} users={res.users}"


def _purge_login_logs(db: Session, redis: Redis, now: datetime) -> str:  # M5b 段 A
    days = get_settings().login_log_days
    res = db.execute(
        delete(LoginLog).where(
            LoginLog.school_id == _school.get(), LoginLog.created_at < now - timedelta(days=days)
        )
    )
    db.commit()
    return f"删除 {res.rowcount} 条"


JOBS: list[Job] = [
    Job("parent-archive", time(3, 10), _parent_archive),
    Job("login-log-purge", time(3, 30), _purge_login_logs),  # M5b 段 A
]


def due_jobs(jobs: list[Job], now_local: datetime, last_run: dict[str, date]) -> list[Job]:
    return [
        j for j in jobs if last_run.get(j.name) != now_local.date() and now_local.time() >= j.at
    ]


def _last_runs(redis: Redis, jobs: list[Job]) -> dict[str, date]:
    out: dict[str, date] = {}
    for j in jobs:
        raw = redis.get(LAST_KEY.format(name=j.name))
        if raw:
            try:
                out[j.name] = date.fromisoformat(raw)
            except ValueError:
                pass
    return out


def run_due(
    db_factory: Callable[[], AbstractContextManager[Session]],
    redis: Redis,
    now: datetime,
    jobs: list[Job] | None = None,
    *,
    school_id: UUID | None = None,
    mono: Callable[[], float] = _time.monotonic,
) -> list[str]:
    """执行所有到期任务,返回实际成功执行的任务名。"""
    jobs = JOBS if jobs is None else jobs
    sid = school_id or get_settings().school_id
    with db_factory() as db:
        if db.get(School, sid) is None:
            t = mono()
            last = _NO_SCHOOL_WARNED.get("t")
            if last is None or t - last >= NO_SCHOOL_WARN_EVERY:
                _NO_SCHOOL_WARNED["t"] = t
                # 首次安装时先于 init-school 启动属正常,不是告警;也不值得占 info 级日志(L116)
                log.debug("scheduler.no_school", school_id=str(sid))
            return []
        now_local = now.astimezone(school_tz(db, sid))
    done: list[str] = []
    token_school = _school.set(sid)
    try:
        for job in due_jobs(jobs, now_local, _last_runs(redis, jobs)):
            if _run_one(db_factory, redis, job, now, now_local):
                done.append(job.name)
    finally:
        _school.reset(token_school)
    return done


def _run_one(db_factory, redis: Redis, job: Job, now: datetime, now_local: datetime) -> bool:
    lock = LOCK_KEY.format(name=job.name)
    last_key = LAST_KEY.format(name=job.name)
    token = uuid.uuid4().hex
    if not redis.set(lock, token, nx=True, ex=LOCK_TTL):
        return False
    try:
        # 抢锁前读到的 last 可能已过期:别的实例也许刚跑完
        if _last_runs(redis, [job]).get(job.name) == now_local.date():
            return False
        try:
            with db_factory() as db:
                summary = job.run(db, redis, now)
        except Exception as exc:
            log.error("scheduler.job", job=job.name, status="error", error=type(exc).__name__)
            return False
        try:
            redis.set(last_key, now_local.date().isoformat())
        except Exception as exc:
            log.warning("scheduler.last_write_failed", job=job.name, error=type(exc).__name__)
        log.info("scheduler.job", job=job.name, status="ok", summary=summary)
        return True
    finally:
        try:
            redis.eval(_RELEASE, 1, lock, token)  # 只删自己的锁
        except Exception as exc:
            log.warning("scheduler.unlock_failed", job=job.name, error=type(exc).__name__)


def serve(settings: Settings, *, interval: float = 30.0) -> None:
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    engine = create_engine(settings.database_url, connect_args={"connect_timeout": 5})
    redis = Redis.from_url(
        settings.redis_url, decode_responses=True, socket_timeout=5, socket_connect_timeout=5
    )
    factory = sessionmaker(bind=engine)
    log.info("scheduler.start", jobs=[j.name for j in JOBS])
    try:
        while not stop.is_set():
            try:
                run_due(factory, redis, utc_now(), school_id=settings.school_id)
            except Exception as exc:
                log.error("scheduler.loop", error=type(exc).__name__)
            stop.wait(interval)
    finally:
        redis.close()
        engine.dispose()
        log.info("scheduler.stop")
