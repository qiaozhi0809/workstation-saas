import io
import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, time
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from structlog.testing import capture_logs

from app.cli import build_parser, scheduler_cmd
from app.deploy.scheduler import JOBS, Job, due_jobs, run_due
from tests.seed_ids import SCHOOL_ID as _SID

SCHOOL_ID = UUID(_SID)
SH = ZoneInfo("Asia/Shanghai")


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


def test_jobs_registry_has_parent_archive():
    assert [(j.name, j.at) for j in JOBS] == [("parent-archive", time(3, 10))]


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
    assert any(entry["event"] == "scheduler.no_school" for entry in logs)


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
