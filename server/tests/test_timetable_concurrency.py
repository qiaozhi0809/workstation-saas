"""作息与课表的并发(L156):删节次与写课表争同一把 School 行锁,不会留下引用已删节次的孤儿格子。

每个用例用线程里的独立 Session 直连一次性容器库(不碰会话级共享测试库),Event 控制时序;
"确认对方已被挡住"靠轮询 pg_stat_activity,不靠 sleep 赌。
"""

import threading
import time
from collections.abc import Callable, Iterator
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.domain.timetable import importer, service
from app.domain.timetable.schemas import CellInput, Period, TimetableImportRow
from app.errors import ApiError
from app.models import AcademicYear, SchoolClass
from tests.concurrent_db import make_concurrent_engine
from tests.seed_ids import CLASS_ID, SCHOOL_ID, YEAR_ID

IT_ADMIN = UUID("55555555-5555-5555-5555-555555555546")
WAIT = 30
PERIODS = [
    Period(no=1, starts_at="08:00", ends_at="08:40"),
    Period(no=2, starts_at="08:50", ends_at="09:30"),
    Period(no=3, starts_at="09:50", ends_at="10:30"),
]
ORPHANS = text(
    "SELECT count(*) FROM timetable_entries e JOIN classes c ON c.id = e.class_id"
    " LEFT JOIN periods p ON p.school_id = c.school_id AND p.no = e.period_no WHERE p.no IS NULL"
)


@pytest.fixture(scope="module")
def cengine() -> Iterator[Engine]:
    with make_concurrent_engine() as eng:
        yield eng


@pytest.fixture(autouse=True)
def clean(cengine: Engine) -> Iterator[None]:
    with cengine.begin() as conn:
        conn.execute(text("DELETE FROM timetable_entries"))
        conn.execute(text("DELETE FROM periods"))
        for p in PERIODS:
            conn.execute(
                text(
                    "INSERT INTO periods (school_id, no, starts_at, ends_at)"
                    " VALUES (:s, :no, :a, :b)"
                ),
                {"s": SCHOOL_ID, "no": p.no, "a": p.starts_at, "b": p.ends_at},
            )
    yield


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
    """轮询直到 other 在等锁;它没被挡住就跑完了 → 失败(修复前的现象)。"""
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
            pytest.fail(f"线程 {other.thread.name} 没有被锁挡住,直接跑完了")
        time.sleep(0.02)
    pytest.fail("没有等到被锁挡住的会话")


def _write_cells(period_no: int) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        cls = db.get(SchoolClass, UUID(CLASS_ID))
        year = db.get(AcademicYear, UUID(YEAR_ID))
        assert cls is not None and year is not None
        cells = [CellInput(weekday=1, period_no=period_no, subject="语文")]
        return service.save_class_timetable(db, cls, year, cells, IT_ADMIN, None)

    return run


def _remove_third(db: Session) -> Any:
    return service.save_periods(db, UUID(SCHOOL_ID), PERIODS[:2], IT_ADMIN, None)


def _import_cell(period_no: int) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        year = db.get(AcademicYear, UUID(YEAR_ID))
        assert year is not None
        row = TimetableImportRow(
            line=2,
            class_name="三年二班",
            weekday=1,
            period_no=period_no,
            subject="语文",
            employee_no=None,
        )
        return importer.import_rows(db, UUID(SCHOOL_ID), year, [row], IT_ADMIN, None)

    return run


def _orphans(engine: Engine) -> int:
    with engine.connect() as conn:
        return conn.execute(ORPHANS).scalar_one()


def test_write_timetable_then_delete_period(cengine, monkeypatch):
    """写课表读完"已设节次"后停住;此时删节次必须等它提交,然后看到第 3 节在用 → 409。"""
    read_done, go = threading.Event(), threading.Event()
    real = service.defined_period_nos

    def paused(db, school_id):
        nos = real(db, school_id)
        read_done.set()
        assert go.wait(WAIT)
        return nos

    monkeypatch.setattr(service, "defined_period_nos", paused)
    writer = Worker(cengine, "write", _write_cells(3)).start()
    try:
        assert read_done.wait(WAIT)
        remover = Worker(cengine, "remove", _remove_third).start()
        _wait_blocked(cengine, remover)
    finally:
        go.set()  # 断言失败也要放开停住的线程,免得它拿着锁拖累下一个用例
    writer.join()
    remover.join()
    assert writer.error is None, writer.error
    assert isinstance(remover.error, ApiError) and remover.error.code == "PERIOD_IN_USE"
    assert _orphans(cengine) == 0
    with cengine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM periods")).scalar_one() == 3


def test_import_vs_delete_period_serialized(cengine, monkeypatch):
    """L290:CSV 导入读完"已设节次"后停住;删节次必须等它提交(同一把 School 锁),
    然后看到第 3 节在用 → 409。修复前导入不拿锁,删节次直接过,留下引用已删节次的格子。"""
    read_done, go = threading.Event(), threading.Event()
    real = service.defined_period_nos

    def paused(db, school_id):
        nos = real(db, school_id)
        read_done.set()
        assert go.wait(WAIT)
        return nos

    monkeypatch.setattr(service, "defined_period_nos", paused)
    writer = Worker(cengine, "import", _import_cell(3)).start()
    try:
        assert read_done.wait(WAIT)
        remover = Worker(cengine, "remove", _remove_third).start()
        _wait_blocked(cengine, remover)
    finally:
        go.set()
    writer.join()
    remover.join()
    assert writer.error is None, writer.error
    assert writer.value.ok is True and writer.value.written == 1
    assert isinstance(remover.error, ApiError) and remover.error.code == "PERIOD_IN_USE"
    assert _orphans(cengine) == 0
    with cengine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM periods")).scalar_one() == 3


def test_delete_period_then_write_timetable(cengine, monkeypatch):
    """删节次已删掉第 3 节但未提交时写课表进来:必须等它提交,然后第 3 节"尚未设置" → 400。"""
    deleted, go = threading.Event(), threading.Event()
    real = service.record

    def paused(db, **kw):
        real(db, **kw)
        if kw.get("action") == "periods.update":
            deleted.set()
            assert go.wait(WAIT)

    monkeypatch.setattr(service, "record", paused)
    remover = Worker(cengine, "remove", _remove_third).start()
    try:
        assert deleted.wait(WAIT)
        writer = Worker(cengine, "write", _write_cells(3)).start()
        _wait_blocked(cengine, writer)
    finally:
        go.set()
    remover.join()
    writer.join()
    assert remover.error is None, remover.error
    assert isinstance(writer.error, ApiError) and writer.error.status == 400
    assert "第 3 节" in writer.error.message
    assert _orphans(cengine) == 0
    with cengine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM timetable_entries")).scalar_one() == 0
