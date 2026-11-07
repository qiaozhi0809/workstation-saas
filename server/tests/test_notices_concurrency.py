"""通知撤回的并发(L45):两个会话同时撤回同一条通知,只有一方真正撤回(条件 UPDATE 抢到行),
审计与推送各只发生一次,recalled_at 只写一次、不被后到的一方覆盖。

每个用例用线程里的独立 Session 直连一次性容器库(不碰会话级共享测试库),Event 控制时序;
"确认对方已被挡住"靠轮询 pg_stat_activity(holder 拿着行锁、另一方在 Lock 上等待),不靠 sleep 赌。
"""

import threading
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from app.domain.notices import service
from app.domain.notices.schemas import NoticeInput
from app.models import User
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings
from tests.concurrent_db import make_concurrent_engine
from tests.seed_ids import YEAR_ID

PRINCIPAL = UUID("55555555-5555-5555-5555-555555555543")
WAIT = 30
T_FIRST = datetime(2026, 11, 9, 1, 0, tzinfo=UTC)
T_SECOND = datetime(2026, 11, 9, 1, 0, 30, tzinfo=UTC)


@pytest.fixture(scope="module")
def cengine() -> Iterator[Engine]:
    with make_concurrent_engine() as eng:
        yield eng


class _CountingRedis:
    """只记 publish 次数;撤回路径里 Redis 只用于推送 notice.recalled。"""

    def __init__(self) -> None:
        self.published: list[str] = []
        self._lock = threading.Lock()

    def publish(self, channel: str, payload: str) -> int:
        with self._lock:
            self.published.append(payload)
        return 1


class Worker:
    """线程里开独立会话执行 fn(db);join 后读 value / error。"""

    def __init__(self, engine: Engine, name: str, fn: Callable[[Session], Any]) -> None:
        self.value: Any = None
        self.error: BaseException | None = None
        self._engine = engine
        self._fn = fn
        self.thread = threading.Thread(target=self._run, name=name, daemon=True)

    def _run(self) -> None:
        try:
            with Session(self._engine) as db:
                self.value = self._fn(db)
        except BaseException as exc:  # noqa: BLE001 - 测试要把线程里的异常带回主线程
            self.error = exc

    def start(self) -> "Worker":
        self.thread.start()
        return self

    def join(self) -> "Worker":
        self.thread.join(WAIT)
        assert not self.thread.is_alive(), f"线程 {self.thread.name} 没有结束"
        return self


def _wait_blocked(engine: Engine, other: Worker) -> None:
    """轮询直到 other 在等锁;它没被挡住就跑完了 → 失败。"""
    deadline = time.monotonic() + WAIT
    while time.monotonic() < deadline:
        with engine.connect() as conn:
            n = conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity"
                    " WHERE datname = current_database() AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
        if n:
            return
        if not other.thread.is_alive():
            pytest.fail(f"线程 {other.thread.name} 没有被行锁挡住,直接跑完了")
        time.sleep(0.02)
    pytest.fail("没有等到被锁挡住的会话")


def _send_notice(engine: Engine, redis: _CountingRedis) -> UUID:
    with Session(engine) as db:
        sender = db.get(User, PRINCIPAL)
        assert sender is not None
        bindings = load_bindings(db, sender.id, UUID(YEAR_ID))
        body = NoticeInput(title="并发撤回", content="测试", target={"kind": "school"})
        return service.send(db, redis, sender, bindings, body, now=T_FIRST).id


def _recall(notice_id: UUID, redis: _CountingRedis, now: datetime) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        sender = db.get(User, PRINCIPAL)
        assert sender is not None
        return service.recall(db, redis, sender, notice_id, now=now)

    return run


def test_concurrent_recall_once(cengine, monkeypatch):
    """holder(先到的一方)在条件 UPDATE 之后、提交之前停住,拿着通知行锁;后到的一方必须等它提交,
    然后看到 recalled_at 已非空 → 影响 0 行:不写审计、不推送、也不改写 recalled_at。"""
    redis = _CountingRedis()
    notice_id = _send_notice(cengine, redis)
    redis.published.clear()  # 不算发送时的 notice.new
    updated, go = threading.Event(), threading.Event()
    real = service.record

    def paused(db, **kw):
        real(db, **kw)
        if kw.get("action") == "notice.recall":
            updated.set()
            assert go.wait(WAIT)

    monkeypatch.setattr(service, "record", paused)
    holder = Worker(cengine, "holder", _recall(notice_id, redis, T_FIRST)).start()
    try:
        assert updated.wait(WAIT)
        other = Worker(cengine, "other", _recall(notice_id, redis, T_SECOND)).start()
        _wait_blocked(cengine, other)
    finally:
        go.set()  # 断言失败也要放开停住的线程,免得它拿着锁拖累后续用例
    holder.join()
    other.join()
    assert holder.error is None, holder.error
    assert other.error is None, other.error
    # 两边返回的视图都是同一次撤回(先到一方的时间),后到的一方没有改写
    assert holder.value.recalled_at == other.value.recalled_at == T_FIRST
    with Session(cengine) as db:
        recalled_at = db.scalar(
            text("SELECT recalled_at FROM notices WHERE id = :n"), {"n": notice_id}
        )
        assert recalled_at == T_FIRST
        recalls = db.scalars(
            select(AuditLog).where(
                AuditLog.object_id == str(notice_id), AuditLog.action == "notice.recall"
            )
        ).all()
    assert len(recalls) == 1
    assert len(redis.published) == 1 and '"notice.recalled"' in redis.published[0]
