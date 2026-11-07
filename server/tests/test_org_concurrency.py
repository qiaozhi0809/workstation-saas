"""班级行锁:任命班主任 / 删班的并发行为。

每个用例用线程里的独立 Session 直连一次性容器库(不碰会话级共享测试库),
Barrier / Event 控制时序;需要"确认对方已被挡住"时轮询 pg_stat_activity,不靠 sleep 赌。
"""

import threading
import time
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app import clock
from app.domain.org import service, staff
from app.domain.org.schemas import ClassInput, GradeInput, StaffInput
from app.domain.years import service as years_service
from app.domain.years.suggest import suggest
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
EMPTY_GRADE_NAME = "并发年级"
WAIT = 30


@pytest.fixture(scope="module")
def cengine() -> Iterator[Engine]:
    with make_concurrent_engine() as eng:
        yield eng


def _reset(engine: Engine) -> None:
    """恢复种子里三年二班的班主任状态(张老师),并清掉用例建的空班 / 空年级。"""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM classes WHERE name = :n"), {"n": EMPTY_CLASS_NAME})
        conn.execute(
            text("DELETE FROM classes WHERE grade_id IN (SELECT id FROM grades WHERE name = :n)"),
            {"n": EMPTY_GRADE_NAME},
        )
        conn.execute(text("DELETE FROM grades WHERE name = :n"), {"n": EMPTY_GRADE_NAME})
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


def _open_homeroom_assignment(engine: Engine, class_id: str = CLASS_ID) -> UUID:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id FROM teacher_assignments WHERE class_id = :c"
                " AND identity = 'homeroom' AND ended_at IS NULL"
            ),
            {"c": class_id},
        ).scalar_one()


def _end_staff(assignment_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        return staff.end_staff(
            db, UUID(SCHOOL_ID), assignment_id, now=clock.utc_now(), actor_id=PRINCIPAL
        )

    return run


def _ended_count(engine: Engine, class_id: str = CLASS_ID) -> int:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT count(*) FROM teacher_assignments WHERE class_id = :c"
                " AND identity = 'homeroom' AND ended_at IS NOT NULL"
            ),
            {"c": class_id},
        ).scalar_one()


def test_end_staff_queued_behind_add_staff_gets_409(cengine, monkeypatch):
    """L52:卸任与换班主任并发:换班主任先拿到班级行锁并结束了旧任职,排在后面的卸任拿到锁时
    任职已不在任 → 409,不再静默改写 ended_at、多记一条成功审计。"""
    old = _open_homeroom_assignment(cengine)
    locked, release = _hold_after_lock(monkeypatch, "add")

    add = Worker(cengine, "add", _assign(TEACHER04)).start()
    assert locked.wait(WAIT)
    end = Worker(cengine, "end", _end_staff(old)).start()
    _wait_blocked(cengine)  # 卸任卡在班级行锁上
    release.set()
    add.join()
    end.join()

    assert add.error is None, add.error
    assert isinstance(end.error, ApiError), end.error
    assert end.error.status == 409 and end.error.code == "STAFF_CHANGED"
    _assert_single_homeroom(cengine, TEACHER04)
    assert _ended_count(cengine) == 1  # 只有张老师那条被结束(由换班主任结束,一次)


def test_add_staff_queued_behind_end_staff_sees_vacant_class(cengine, monkeypatch):
    """L52 反向:卸任先持锁,换班主任等它提交后再进,看到的是"暂无班主任",两边都成功。"""
    old = _open_homeroom_assignment(cengine)
    locked, release = _hold_after_lock(monkeypatch, "end")

    end = Worker(cengine, "end", _end_staff(old)).start()
    assert locked.wait(WAIT)
    add = Worker(cengine, "add", _assign(TEACHER04)).start()
    _wait_blocked(cengine)  # 任命卡在班级行锁上
    release.set()
    end.join()
    add.join()

    assert end.error is None and add.error is None, (end.error, add.error)
    _assert_single_homeroom(cengine, TEACHER04)
    assert _ended_count(cengine) == 1


def _rename_class(class_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        cls = db.get(SchoolClass, class_id)
        assert cls is not None
        body = ClassInput(grade_id=UUID(GRADE_ID), name=f"{EMPTY_CLASS_NAME}改", room="")
        return service.update_class(db, UUID(SCHOOL_ID), cls, body, PRINCIPAL, None)

    return run


def test_update_class_waits_for_lock_and_fails_after_delete(cengine, monkeypatch):
    """L52:改班级信息也走班级行锁:删班先持锁,改名排在后面,删班提交后改名得到 404 而不是
    对已不存在的行做 UPDATE(StaleDataError → 500)。"""
    class_id = _new_empty_class(cengine)
    locked, release = _hold_after_lock(monkeypatch, "del")

    delete = Worker(cengine, "del", _delete_class(class_id)).start()
    assert locked.wait(WAIT)
    rename = Worker(cengine, "ren", _rename_class(class_id)).start()
    _wait_blocked(cengine)  # 改名卡在班级行锁上
    release.set()
    delete.join()
    rename.join()

    assert delete.error is None, delete.error
    assert isinstance(rename.error, ApiError), rename.error
    assert rename.error.status == 404 and rename.error.code == "NOT_FOUND"
    assert not _class_exists(cengine, class_id)


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


# ---- L261:建班 / 建年级与学年回滚、删年级的窗口 ----


def _wait_until_blocked(engine: Engine, count: int = 1) -> None:
    """轮询 pg_blocking_pids,直到至少 count 个会话被别的会话的锁挡住(同 test_years_concurrency)。"""
    deadline = time.monotonic() + WAIT
    with engine.connect() as conn:
        while time.monotonic() < deadline:
            n = conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
                    " AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0"
                )
            ).scalar_one()
            if n >= count:
                return
            time.sleep(0.02)
    raise AssertionError("没有等到任何会话被锁挡住")


def _create_class_in(grade_id: UUID, year_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        return service.create_class(
            db,
            UUID(SCHOOL_ID),
            year_id,
            ClassInput(grade_id=grade_id, name=EMPTY_CLASS_NAME),
            PRINCIPAL,
            None,
        )

    return run


def _undo_upgrades(engine: Engine) -> None:
    """把库复原:逐个回滚升级,再清掉升级记录(同 test_years_concurrency 的 clean)。"""
    with Session(engine) as s:
        while True:
            try:
                years_service.rollback(s, UUID(SCHOOL_ID), now=datetime.now(UTC))
            except years_service.UpgradeError as e:
                assert e.code == "UPGRADE_NOTHING_TO_ROLLBACK"
                break
        s.execute(text("DELETE FROM year_upgrades"))
        s.commit()


def test_create_class_queued_behind_rollback_gets_409(cengine, monkeypatch):
    """L261:回滚统计完新学年数据、持学年行 FOR UPDATE 还没删之前,有人在新学年建班。
    建班对学年行取 KEY SHARE 要等回滚提交;学年已删 → 409 NO_ACTIVE_YEAR,
    而不是 INSERT 撞学年外键 500,也不会把新班写进一个马上被级联删掉的学年。"""
    school = UUID(SCHOOL_ID)
    try:
        with Session(cengine) as s:
            plan = suggest(s, school, "2027-2028", date(2027, 9, 1), date(2028, 7, 15))
            years_service.apply(s, school, plan, now=datetime.now(UTC))
            new_year_id, grade_id = s.execute(
                text(
                    "SELECT g.academic_year_id, g.id FROM grades g"
                    " JOIN academic_years y ON y.id = g.academic_year_id AND y.is_active"
                    " ORDER BY g.display_order LIMIT 1"
                )
            ).one()
        counted, release = threading.Event(), threading.Event()
        original = years_service._edits_since_upgrade

        def stalled(*args, **kwargs):
            out = original(*args, **kwargs)
            counted.set()
            assert release.wait(WAIT)
            return out

        monkeypatch.setattr(years_service, "_edits_since_upgrade", stalled)
        roller = Worker(
            cengine,
            "roll",
            lambda db: years_service.rollback(db, school, now=datetime.now(UTC)),
        ).start()
        creator = Worker(cengine, "create", _create_class_in(grade_id, new_year_id))
        try:
            assert counted.wait(WAIT)  # 回滚已统计完,停在删除之前,持学年行锁
            creator.start()
            _wait_until_blocked(cengine, 1)  # 建班卡在学年行锁上
        finally:
            release.set()
        roller.join()
        creator.join()
        assert roller.error is None, roller.error
        assert isinstance(creator.error, ApiError), creator.error
        assert creator.error.status == 409 and creator.error.code == "NO_ACTIVE_YEAR"
        with cengine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM classes WHERE name = :n"), {"n": EMPTY_CLASS_NAME}
                ).scalar_one()
                == 0
            )
            assert conn.execute(
                text("SELECT id FROM academic_years WHERE is_active")
            ).scalar_one() == UUID(YEAR_ID)
    finally:
        _undo_upgrades(cengine)


def _new_empty_grade(engine: Engine) -> UUID:
    with Session(engine) as db:
        out = service.create_grade(
            db,
            UUID(SCHOOL_ID),
            UUID(YEAR_ID),
            GradeInput(name=EMPTY_GRADE_NAME, display_order=9),
            PRINCIPAL,
            None,
        )
    return out.id


def _delete_grade(grade_id: UUID) -> Callable[[Session], Any]:
    def run(db: Session) -> Any:
        return service.delete_grade(db, UUID(SCHOOL_ID), grade_id, PRINCIPAL, clock.utc_now(), None)

    return run


def _hold_after_grade_lock(monkeypatch, who: str) -> tuple[threading.Event, threading.Event]:
    """名为 who 的线程拿到年级行锁后停住。返回 (已持锁, 放行)。"""
    locked, release = threading.Event(), threading.Event()
    original = service.lock_grade

    def wrapped(db, grade_id):
        original(db, grade_id)
        if threading.current_thread().name == who:
            locked.set()
            assert release.wait(WAIT)

    monkeypatch.setattr(service, "lock_grade", wrapped)
    return locked, release


def _grade_exists(engine: Engine, grade_id: UUID) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(text("SELECT 1 FROM grades WHERE id = :g"), {"g": grade_id}).first()
            is not None
        )


def test_delete_grade_vs_create_class_no_500(cengine, monkeypatch):
    """L261:删年级与在该年级建班并发,两个方向都不 500。
    删年级先持年级行锁:排在后面的建班拿到锁时年级已没了 → 404;
    建班先持年级行锁:排在后面的删年级拿到锁时数到新班 → 409 GRADE_NOT_EMPTY。"""
    grade_id = _new_empty_grade(cengine)
    locked, release = _hold_after_grade_lock(monkeypatch, "del")
    delete = Worker(cengine, "del", _delete_grade(grade_id)).start()
    try:
        assert locked.wait(WAIT)
        create = Worker(cengine, "create", _create_class_in(grade_id, UUID(YEAR_ID))).start()
        _wait_until_blocked(cengine, 1)  # 建班卡在年级行锁上
    finally:
        release.set()
    delete.join()
    create.join()
    assert delete.error is None, delete.error
    assert isinstance(create.error, ApiError), create.error
    assert create.error.status == 404 and create.error.code == "NOT_FOUND"
    assert not _grade_exists(cengine, grade_id)

    # 反向:建班先拿到年级行锁
    monkeypatch.undo()
    grade_id = _new_empty_grade(cengine)
    locked, release = _hold_after_grade_lock(monkeypatch, "create")
    create = Worker(cengine, "create", _create_class_in(grade_id, UUID(YEAR_ID))).start()
    try:
        assert locked.wait(WAIT)
        delete = Worker(cengine, "del", _delete_grade(grade_id)).start()
        _wait_until_blocked(cengine, 1)  # 删年级卡在年级行锁上
    finally:
        release.set()
    create.join()
    delete.join()
    assert create.error is None, create.error
    assert isinstance(delete.error, ApiError), delete.error
    assert delete.error.status == 409 and delete.error.code == "GRADE_NOT_EMPTY"
    assert _grade_exists(cengine, grade_id)
    assert _class_exists(cengine, create.value.id)
