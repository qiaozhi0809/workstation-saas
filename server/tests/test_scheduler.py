import io
import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, time
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
import structlog
from structlog.testing import capture_logs

from app.cli import build_parser, scheduler_cmd
from app.deploy import scheduler as _sch
from app.deploy.scheduler import JOBS, Job, due_jobs, run_due
from app.domain.parents import lifecycle
from tests.seed_ids import SCHOOL_ID as _SID

SCHOOL_ID = UUID(_SID)
SH = ZoneInfo("Asia/Shanghai")


@pytest.fixture(autouse=True)
def _reset_warn_state():
    _sch._NO_SCHOOL_WARNED.clear()


def _local(day: int, h: int, m: int) -> datetime:
    return datetime(2026, 11, day, h, m, tzinfo=SH)


def _factory(db):
    @contextmanager
    def factory():
        yield db

    return factory


def _job(calls: list, *, fail: bool = False, name: str = "t-job") -> Job:
    def run(db, redis, now):
        calls.append(now)
        if fail:
            raise RuntimeError("secret-token-xyz")
        return "ok 1"

    return Job(name, time(3, 10), run)


def test_due_jobs():
    job = _job([])
    assert due_jobs([job], _local(5, 3, 9), {}) == []
    assert due_jobs([job], _local(5, 3, 10), {}) == [job]
    assert due_jobs([job], _local(5, 23, 59), {}) == [job]
    assert due_jobs([job], _local(5, 4, 0), {"t-job": date(2026, 11, 5)}) == []
    assert due_jobs([job], _local(6, 3, 9), {"t-job": date(2026, 11, 5)}) == []
    assert due_jobs([job], _local(6, 3, 10), {"t-job": date(2026, 11, 5)}) == [job]


def test_jobs_registry():
    assert [(j.name, j.at) for j in JOBS] == [
        ("parent-archive", time(3, 10)),
        ("login-log-purge", time(3, 30)),
    ]


def test_login_log_purge_runs_when_due(db, redis_client, settings, monkeypatch):
    from datetime import timedelta

    from sqlalchemy import select

    from app.models import LoginLog

    monkeypatch.setattr("app.deploy.scheduler.get_settings", lambda: settings)
    purge = next(j for j in JOBS if j.name == "login-log-purge")
    now = _local(5, 3, 35).astimezone(UTC)
    old = LoginLog(
        school_id=SCHOOL_ID,
        login_name="a",
        result="bad_password",
        created_at=now - timedelta(days=181),
    )
    keep = LoginLog(
        school_id=SCHOOL_ID, login_name="b", result="success", created_at=now - timedelta(days=179)
    )
    db.add_all([old, keep])
    db.flush()
    early = _local(5, 3, 25).astimezone(UTC)
    assert run_due(_factory(db), redis_client, early, [purge], school_id=SCHOOL_ID) == []
    assert run_due(_factory(db), redis_client, now, [purge], school_id=SCHOOL_ID) == [
        "login-log-purge"
    ]
    assert set(db.scalars(select(LoginLog.login_name))) == {"b"}


def test_job_runs_once_per_day_across_restart(db, redis_client):
    calls: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == ["t-job"]
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == []
    assert len(calls) == 1
    assert redis_client.get("ws:job:last:t-job") == "2026-11-05"
    assert redis_client.get("ws:job:lock:t-job") is None
    redis_client.delete("ws:job:last:t-job")
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == ["t-job"]
    assert len(calls) == 2
    next_day = _local(6, 3, 20).astimezone(UTC)
    assert run_due(_factory(db), redis_client, next_day, [_job(calls)], school_id=SCHOOL_ID) == [
        "t-job"
    ]


def test_failed_job_retries(db, redis_client):
    calls: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    with capture_logs() as logs:
        assert (
            run_due(_factory(db), redis_client, now, [_job(calls, fail=True)], school_id=SCHOOL_ID)
            == []
        )
    assert redis_client.get("ws:job:last:t-job") is None
    assert redis_client.get("ws:job:lock:t-job") is None  # 失败也释放锁
    assert any(entry["log_level"] == "error" and entry["job"] == "t-job" for entry in logs)
    assert "secret-token-xyz" not in json.dumps(logs, default=str)
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == ["t-job"]
    assert len(calls) == 2


def test_run_due_skips_without_school(db, redis_client):
    calls: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    with capture_logs() as logs:
        done = run_due(_factory(db), redis_client, now, [_job(calls)], school_id=uuid4())
    assert done == [] and calls == []
    entries = [e for e in logs if e["event"] == "scheduler.no_school"]
    assert entries and all(e["log_level"] == "info" for e in entries)


def test_run_due_skips_when_locked(db, redis_client):
    calls: list = []
    redis_client.set("ws:job:lock:t-job", "1", ex=600)
    now = _local(5, 3, 15).astimezone(UTC)
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == []
    assert calls == []
    assert redis_client.get("ws:job:lock:t-job") == "1"  # 不动别人的锁


def test_not_due_does_not_run(db, redis_client):
    calls: list = []
    now = _local(5, 3, 9).astimezone(UTC)
    assert run_due(_factory(db), redis_client, now, [_job(calls)], school_id=SCHOOL_ID) == []
    assert calls == []


def test_success_log_is_one_json_line_without_secrets(db, redis_client, capsys):
    from app.logging import configure_logging

    configure_logging("info")
    try:
        now = _local(5, 3, 15).astimezone(UTC)
        run_due(_factory(db), redis_client, now, [_job([])], school_id=SCHOOL_ID)
    finally:
        structlog.reset_defaults()
    lines = [ln for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    entry = json.loads(lines[-1])
    assert entry["job"] == "t-job" and entry["summary"] == "ok 1"
    assert "password" not in lines[-1].lower() and "token" not in lines[-1].lower()


def test_scheduler_once_runs_due_parent_archive(db, settings, redis_client, monkeypatch):
    monkeypatch.setattr("app.cli.get_settings", lambda: settings)
    monkeypatch.setattr("app.deploy.scheduler.get_settings", lambda: settings)
    now = _local(5, 3, 15).astimezone(UTC)
    monkeypatch.setattr("app.deploy.scheduler.utc_now", lambda: now)
    out = io.StringIO()
    ns = build_parser().parse_args(["scheduler", "--once"])
    assert ns.once is True
    code = scheduler_cmd(ns, db_factory=_factory(db), redis=redis_client, out=out)
    assert code == 0
    assert out.getvalue().strip() == "parent-archive"
    assert redis_client.get("ws:job:last:parent-archive") == "2026-11-05"
    out2 = io.StringIO()
    assert scheduler_cmd(ns, db_factory=_factory(db), redis=redis_client, out=out2) == 0
    assert out2.getvalue().strip() == ""


class _Proxy:
    """包一层 Redis,按需在某个调用前后插入行为。"""

    def __init__(self, inner, *, before_lock=None, fail_on=()):
        self._inner = inner
        self._before_lock = before_lock
        self._fail_on = fail_on

    def __getattr__(self, name):
        attr = getattr(self._inner, name)
        if name in self._fail_on:

            def boom(*a, **k):
                if name == "set" and not str(a[0]).startswith("ws:job:last:"):
                    return attr(*a, **k)
                raise ConnectionError("redis down")

            return boom
        if name == "set" and self._before_lock:

            def wrapped(*a, **k):
                if str(a[0]).startswith("ws:job:lock:") and self._before_lock:
                    hook, self._before_lock = self._before_lock, None
                    hook()
                return attr(*a, **k)

            return wrapped
        return attr


def test_lock_acquired_after_other_finished_rechecks_last(db, redis_client):
    calls: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    # B 已读到 last 为空,A 随后跑完写了 last,B 才抢到锁
    proxy = _Proxy(
        redis_client, before_lock=lambda: redis_client.set("ws:job:last:t-job", "2026-11-05")
    )
    assert run_due(_factory(db), proxy, now, [_job(calls)], school_id=SCHOOL_ID) == []
    assert calls == []
    assert redis_client.get("ws:job:lock:t-job") is None


def test_does_not_delete_lock_owned_by_someone_else(db, redis_client):
    now = _local(5, 3, 15).astimezone(UTC)

    def run(db_, redis_, now_):
        redis_client.set("ws:job:lock:t-job", "other-token", ex=600)  # 模拟 TTL 过期后被别人拿走
        return "ok"

    assert run_due(
        _factory(db), redis_client, now, [Job("t-job", time(3, 10), run)], school_id=SCHOOL_ID
    ) == ["t-job"]
    assert redis_client.get("ws:job:lock:t-job") == "other-token"


def test_last_write_failure_is_not_job_failure(db, redis_client):
    calls: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    proxy = _Proxy(redis_client, fail_on=("set",))
    with capture_logs() as logs:
        done = run_due(_factory(db), proxy, now, [_job(calls)], school_id=SCHOOL_ID)
    assert done == ["t-job"]
    events = [(e["log_level"], e["event"]) for e in logs]
    assert ("warning", "scheduler.last_write_failed") in events
    assert not any(lvl == "error" for lvl, _ in events)


def test_lock_release_failure_does_not_block_other_jobs(db, redis_client):
    a: list = []
    b: list = []
    now = _local(5, 3, 15).astimezone(UTC)
    proxy = _Proxy(redis_client, fail_on=("eval",))
    done = run_due(
        _factory(db),
        proxy,
        now,
        [_job(a, name="j1"), _job(b, name="j2")],
        school_id=SCHOOL_ID,
    )
    assert done == ["j1", "j2"] and len(a) == len(b) == 1


def test_parent_archive_uses_school_id_from_run_due(db, redis_client, settings, monkeypatch):
    seen: dict = {}

    def fake(db_, school_id, now, redis, *, dry_run=False, via="cli"):
        seen.update(school_id=school_id, via=via, dry_run=dry_run)
        return lifecycle.ArchiveResult(links=0, users=0)

    monkeypatch.setattr("app.deploy.scheduler.lifecycle.archive_expired", fake)
    monkeypatch.setattr(
        "app.deploy.scheduler.get_settings",
        lambda: settings.model_copy(update={"school_id": uuid4()}),
    )
    now = _local(5, 3, 15).astimezone(UTC)
    assert run_due(_factory(db), redis_client, now, school_id=SCHOOL_ID) == ["parent-archive"]
    assert seen == {"school_id": SCHOOL_ID, "via": "scheduler", "dry_run": False}


def test_no_school_warning_is_throttled(db, redis_client):
    now = _local(5, 3, 15).astimezone(UTC)
    t = [1000.0]
    with capture_logs() as logs:
        for at in (1000.0, 1030.0, 4599.0, 4601.0):
            t[0] = at
            run_due(
                _factory(db), redis_client, now, [_job([])], school_id=uuid4(), mono=lambda: t[0]
            )
    assert len([e for e in logs if e["event"] == "scheduler.no_school"]) == 2


def test_serve_survives_run_due_errors(settings, monkeypatch):
    handlers = {}
    monkeypatch.setattr(_sch.signal, "signal", lambda sig, h: handlers.setdefault(sig, h))
    created = {}

    class FakeRedis:
        def close(self):
            pass

    class FakeEngine:
        def dispose(self):
            pass

    def fake_engine(url, **kw):
        created["engine_kw"] = kw
        return FakeEngine()

    def fake_redis(url, **kw):
        created["redis_kw"] = kw
        return FakeRedis()

    monkeypatch.setattr(_sch, "create_engine", fake_engine)
    monkeypatch.setattr(_sch.Redis, "from_url", staticmethod(fake_redis))
    monkeypatch.setattr(_sch, "sessionmaker", lambda bind: None)
    calls = []

    def fake_run_due(*a, **k):
        calls.append(1)
        if len(calls) <= 2:
            raise RuntimeError("redis down")
        handlers[_sch.signal.SIGTERM](None, None)  # 第三次:请求停止
        return []

    monkeypatch.setattr(_sch, "run_due", fake_run_due)
    _sch.serve(settings, interval=0)
    assert len(calls) == 3  # 前两次异常没有让循环退出
    assert created["redis_kw"]["socket_timeout"] == 5
    assert created["redis_kw"]["socket_connect_timeout"] == 5
    assert created["engine_kw"]["connect_args"] == {"connect_timeout": 5}
