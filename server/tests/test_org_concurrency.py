"""班级行锁:任命班主任 / 删班的并发行为。

每个用例用线程里的独立 Session 直连一次性容器库(不碰会话级共享测试库),
Barrier / Event 控制时序;需要"确认对方已被挡住"时轮询 pg_stat_activity,不靠 sleep 赌。
"""

import threading
import time
from collections.abc import Callable, Iterator
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app import clock
from app.domain.org import service, staff
from app.domain.org.schemas import ClassInput, StaffInput
from app.errors import ApiError
from app.models import SchoolClass
from tests.concurrent_db import make_concurrent_engine
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, TEACHER_USER_ID

PRINCIPAL = UUID("55555555-5555-5555-5555-555555555543")
TEACHER04 = UUID("55555555-5555-5555-5555-555555555541")
TEACHER04_TID = "66666666-6666-6666-6666-666666666641"
TEACHER05 = UUID("55555555-5555-5555-5555-555555555542")
TEACHER05_TID = "66666666-6666-6666-6666-666666666642"
TEACHER01_TID = "66666666-6666-6666-6666-666666666666"
YEAR_ID = "22222222-2222-2222-2222-222222222222"
EMPTY_CLASS_NAME = "并发空班"
WAIT = 30


@pytest.fixture(scope="module")
def cengine() -> Iterator[Engine]:
    with make_concurrent_engine() as eng:
        yield eng


def _reset(engine: Engine) -> None:
    """恢复种子里三年二班的班主任状态(张老师),并清掉用例建的空班。"""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM classes WHERE name = :n"), {"n": EMPTY_CLASS_NAME})
        conn.execute(
            text(
                "DELETE FROM role_bindings WHERE scope->>'class_id' IS NOT NULL"
                " AND (scope->>'class_id' NOT IN (SELECT id::text FROM classes)"
                " OR (role_type = 'homeroom_teacher' AND scope->>'class_id' = :c))"
            ),
            {"c": CLASS_ID},
        )
        conn.execute(
            text("DELETE FROM teacher_assignments WHERE class_id = :c AND identity = 'homeroom'"),
            {"c": CLASS_ID},
        )
        conn.execute(
            text(
                "INSERT INTO teacher_assignments"
                " (teacher_id, class_id, academic_year_id, identity, subject)"
                " VALUES (:t, :c, :y, 'homeroom', '语文')"
            ),
            {"t": TEACHER01_TID, "c": CLASS_ID, "y": YEAR_ID},
        )
        conn.execute(
            text(
                "INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id)"
                " VALUES (:u, 'homeroom_teacher', jsonb_build_object('class_id', CAST(:c AS text)),"
                " :y)"
            ),
            {"u": TEACHER_USER_ID, "c": CLASS_ID, "y": YEAR_ID},
        )
        conn.execute(
            text("UPDATE classes SET homeroom_teacher_id = :t WHERE id = :c"),
            {"t": TEACHER01_TID, "c": CLASS_ID},
        )


@pytest.fixture(autouse=True)
def clean(cengine: Engine) -> Iterator[None]:
    _reset(cengine)
    yield
    _reset(cengine)


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


def _assign(user_id: UUID, barrier: threading.Barrier | None = None) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        cls = db.get(SchoolClass, UUID(CLASS_ID))
        assert cls is not None
        if barrier is not None:
            barrier.wait(WAIT)
        body = StaffInput(user_id=user_id, identity="homeroom")
        return staff.add_staff(db, cls, body, now=clock.utc_now(), actor_id=PRINCIPAL)

    return run


def _wait_blocked(engine: Engine) -> None:
    """轮询直到有后端在等锁(对方已被挡住);超时即失败。"""
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
        time.sleep(0.02)
    pytest.fail("没有等到被锁挡住的会话")


def _homeroom_state(engine: Engine, class_id: str = CLASS_ID) -> dict[str, list[str]]:
    with engine.connect() as conn:
        assignments = conn.execute(
            text(
                "SELECT t.user_id::text FROM teacher_assignments ta"
                " JOIN teachers t ON t.id = ta.teacher_id"
                " WHERE ta.class_id = :c AND ta.identity = 'homeroom' AND ta.ended_at IS NULL"
            ),
            {"c": class_id},
        ).scalars()
        bindings = conn.execute(
            text(
                "SELECT user_id::text FROM role_bindings WHERE role_type = 'homeroom_teacher'"
                " AND ended_at IS NULL AND scope->>'class_id' = :c"
            ),
            {"c": class_id},
        ).scalars()
        column = conn.execute(
            text(
                "SELECT t.user_id::text FROM classes c JOIN teachers t"
                " ON t.id = c.homeroom_teacher_id WHERE c.id = :c"
            ),
            {"c": class_id},
        ).scalars()
        return {
            "assignments": list(assignments),
            "bindings": list(bindings),
            "column": list(column),
        }


def _assert_single_homeroom(engine: Engine, expected: UUID | None = None) -> str:
    state = _homeroom_state(engine)
    assert len(state["assignments"]) == 1, state
    holder = state["assignments"][0]
    assert state["bindings"] == [holder] and state["column"] == [holder], state
    if expected is not None:
        assert holder == str(expected), state
    return holder


def test_concurrent_homeroom_assignments_are_serialized(cengine):
    barrier = threading.Barrier(2)
    a = Worker(cengine, "A", _assign(TEACHER04, barrier)).start()
    b = Worker(cengine, "B", _assign(TEACHER05, barrier)).start()
    a.join()
    b.join()
    assert a.error is None and b.error is None, (a.error, b.error)
    holder = _assert_single_homeroom(cengine)
    assert holder in (str(TEACHER04), str(TEACHER05))
    with cengine.connect() as conn:
        ended = conn.execute(
            text(
                "SELECT count(*) FROM teacher_assignments WHERE class_id = :c"
                " AND identity = 'homeroom' AND ended_at IS NOT NULL"
            ),
            {"c": CLASS_ID},
        ).scalar_one()
    # 张老师 + 先到的那位都被结束
    assert ended == 2


def _end_current_homeroom(engine: Engine) -> None:
    """让班级处于"暂无班主任"的状态,这样后到的写入不会先卡在旧任职行上,而是卡在唯一索引。"""
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE teacher_assignments SET ended_at = now() WHERE class_id = :c"),
            {"c": CLASS_ID},
        )
        conn.execute(
            text(
                "UPDATE role_bindings SET ended_at = now() WHERE role_type = 'homeroom_teacher'"
                " AND scope->>'class_id' = :c AND ended_at IS NULL"
            ),
            {"c": CLASS_ID},
        )
        conn.execute(
            text("UPDATE classes SET homeroom_teacher_id = NULL WHERE id = :c"), {"c": CLASS_ID}
        )


def _stall_a_in_record(monkeypatch) -> tuple[threading.Event, threading.Event]:
    """线程 A 在 staff.record 处停住(任职已写、未提交)。返回 (A 已停住, 放行 A)。"""
    in_record, release = threading.Event(), threading.Event()
    original = staff.record

    def stalled(*args, **kwargs):
        if threading.current_thread().name == "A":
            in_record.set()
            assert release.wait(WAIT)
        return original(*args, **kwargs)

    monkeypatch.setattr(staff, "record", stalled)
    return in_record, release


def test_unique_index_violation_maps_to_409_when_lock_is_bypassed(cengine, monkeypatch):
    _end_current_homeroom(cengine)
    monkeypatch.setattr(service, "lock_class", lambda db, cls: None)
    in_record, release = _stall_a_in_record(monkeypatch)

    a = Worker(cengine, "A", _assign(TEACHER04)).start()
    assert in_record.wait(WAIT)
    b = Worker(cengine, "B", _assign(TEACHER05)).start()
    _wait_blocked(cengine)  # B 的 INSERT 卡在部分唯一索引上
    release.set()
    a.join()
    b.join()

    assert a.error is None, a.error
    assert isinstance(b.error, ApiError), b.error
    assert b.error.status == 409 and b.error.code == "HOMEROOM_TAKEN"
    _assert_single_homeroom(cengine, TEACHER04)


def test_row_lock_blocks_second_assignment_until_first_commits(cengine, monkeypatch):
    _end_current_homeroom(cengine)
    in_record, release = _stall_a_in_record(monkeypatch)

    a = Worker(cengine, "A", _assign(TEACHER04)).start()
    assert in_record.wait(WAIT)
    b = Worker(cengine, "B", _assign(TEACHER05)).start()
    _wait_blocked(cengine)  # B 卡在班级行锁上
    release.set()
    a.join()
    b.join()

    assert a.error is None and b.error is None, (a.error, b.error)
    _assert_single_homeroom(cengine, TEACHER05)


def _new_empty_class(engine: Engine) -> UUID:
    with Session(engine) as db:
        out = service.create_class(
            db,
            UUID(SCHOOL_ID),
            UUID(YEAR_ID),
            ClassInput(grade_id=UUID(GRADE_ID), name=EMPTY_CLASS_NAME),
            PRINCIPAL,
            None,
        )
    return out.id


def _hold_after_lock(monkeypatch, who: str) -> tuple[threading.Event, threading.Event]:
    """名为 who 的线程拿到班级行锁后停住。返回 (已持锁, 放行)。"""
    locked, release = threading.Event(), threading.Event()
    original = service.lock_class

    def wrapped(db, cls):
        original(db, cls)
        if threading.current_thread().name == who:
            locked.set()
            assert release.wait(WAIT)

    monkeypatch.setattr(service, "lock_class", wrapped)
    return locked, release


def _add_homeroom(class_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        cls = db.get(SchoolClass, class_id)
        assert cls is not None
        body = StaffInput(user_id=TEACHER04, identity="homeroom")
        return staff.add_staff(db, cls, body, now=clock.utc_now(), actor_id=PRINCIPAL)

    return run


def _delete_class(class_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        cls = db.get(SchoolClass, class_id)
        assert cls is not None
        return service.delete_class(db, cls, PRINCIPAL, clock.utc_now(), None)

    return run


def _class_exists(engine: Engine, class_id: UUID) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(text("SELECT 1 FROM classes WHERE id = :c"), {"c": class_id}).first()
            is not None
        )


def _open_bindings(engine: Engine, class_id: UUID) -> int:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT count(*) FROM role_bindings"
                " WHERE ended_at IS NULL AND scope->>'class_id' = :c"
            ),
            {"c": str(class_id)},
        ).scalar_one()


def test_assignment_first_then_delete_ends_the_binding(cengine, monkeypatch):
    class_id = _new_empty_class(cengine)
    locked, release = _hold_after_lock(monkeypatch, "add")

    add = Worker(cengine, "add", _add_homeroom(class_id)).start()
    assert locked.wait(WAIT)
    delete = Worker(cengine, "del", _delete_class(class_id)).start()
    _wait_blocked(cengine)  # 删班卡在班级行锁上
    release.set()
    add.join()
    delete.join()

    assert add.error is None and delete.error is None, (add.error, delete.error)
    assert not _class_exists(cengine, class_id)
    assert _open_bindings(cengine, class_id) == 0


def test_delete_first_then_assignment_fails_as_not_found(cengine, monkeypatch):
    class_id = _new_empty_class(cengine)
    locked, release = _hold_after_lock(monkeypatch, "del")

    delete = Worker(cengine, "del", _delete_class(class_id)).start()
    assert locked.wait(WAIT)
    add = Worker(cengine, "add", _add_homeroom(class_id)).start()
    _wait_blocked(cengine)  # 任命卡在班级行锁上
    release.set()
    delete.join()
    add.join()

    assert delete.error is None, delete.error
    assert isinstance(add.error, ApiError), add.error
    assert add.error.status == 404 and add.error.code == "NOT_FOUND"
    assert not _class_exists(cengine, class_id)
    assert _open_bindings(cengine, class_id) == 0
