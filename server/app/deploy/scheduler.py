"""常驻定时任务:每天学校本地时间到点执行一次(M5a 只有家长归档)。

上次运行日期存 Redis(`ws:job:last:<name>`),重启不会重跑也不会漏跑;
执行前先抢 `ws:job:lock:<name>`,多个实例同时在跑也只有一个执行。
日志每次一行 JSON,只写任务名、状态、摘要和异常类型,不写异常消息。
"""

import signal
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime, time
from uuid import UUID

import structlog
from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.clock import utc_now
from app.config import Settings, get_settings
from app.domain.parents import lifecycle
from app.domain.schools.service import school_tz
from app.models import School

log = structlog.get_logger()

LAST_KEY = "ws:job:last:{name}"
LOCK_KEY = "ws:job:lock:{name}"
LOCK_TTL = 600


@dataclass(frozen=True)
class Job:
    name: str
    at: time  # 学校本地时间
    run: Callable[[Session, Redis, datetime], str]


def _parent_archive(db: Session, redis: Redis, now: datetime) -> str:
    res = lifecycle.archive_expired(db, get_settings().school_id, now, redis, dry_run=False)
    return f"archived links={res.links} users={res.users}"


JOBS: list[Job] = [Job("parent-archive", time(3, 10), _parent_archive)]


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
) -> list[str]:
    """执行所有到期任务,返回实际成功执行的任务名。"""
    jobs = JOBS if jobs is None else jobs
    sid = school_id or get_settings().school_id
    with db_factory() as db:
        if db.get(School, sid) is None:
            log.warning("scheduler.no_school", school_id=str(sid))
            return []
        now_local = now.astimezone(school_tz(db, sid))
    done: list[str] = []
    for job in due_jobs(jobs, now_local, _last_runs(redis, jobs)):
        lock = LOCK_KEY.format(name=job.name)
        if not redis.set(lock, "1", nx=True, ex=LOCK_TTL):
            continue
        try:
            with db_factory() as db:
                summary = job.run(db, redis, now)
            redis.set(LAST_KEY.format(name=job.name), now_local.date().isoformat())
            log.info("scheduler.job", job=job.name, status="ok", summary=summary)
            done.append(job.name)
        except Exception as exc:
            log.error("scheduler.job", job=job.name, status="error", error=type(exc).__name__)
        finally:
            redis.delete(lock)
    return done


def serve(settings: Settings, *, interval: float = 30.0) -> None:
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    engine = create_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
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
