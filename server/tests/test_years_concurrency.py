"""学年升级的并发:apply / rollback 在独立会话里同时进入,数据库最终状态必须一致。

整个模块用一个一次性容器(tests/concurrent_db.py),不碰会话级共享测试库;
用 threading.Barrier 让两边同时放行,不靠 sleep 赌时序。
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

from app.domain.years.plan import UpgradePlan
from app.domain.years.service import UpgradeError, apply, rollback
from app.domain.years.suggest import suggest
from tests.concurrent_db import make_concurrent_engine
from tests.seed_ids import SCHOOL_ID, YEAR_ID

SCHOOL = UUID(SCHOOL_ID)
WAIT = 60


@pytest.fixture(scope="module")
def cengine() -> Iterator[Engine]:
    with make_concurrent_engine() as eng:
        yield eng


@pytest.fixture
def clean(cengine: Engine) -> Iterator[Engine]:
    """用例结束时把库复原:逐个回滚升级,再清掉升级记录。"""
    yield cengine
    with Session(cengine) as s:
        while True:
            try:
                rollback(s, SCHOOL, now=datetime.now(UTC))
            except UpgradeError as e:
                assert e.code == "UPGRADE_NOTHING_TO_ROLLBACK"
                break
        s.execute(text("DELETE FROM year_upgrades"))
        s.commit()


def _plan(engine: Engine, name: str = "2027-2028") -> UpgradePlan:
    with Session(engine) as s:
        return suggest(s, SCHOOL, name, date(2027, 9, 1), date(2028, 7, 15))


def _apply(plan: UpgradePlan) -> Callable[[Session], Any]:
    return lambda s: apply(s, SCHOOL, plan, now=datetime.now(UTC))


def _rollback(s: Session) -> Any:
    return rollback(s, SCHOOL, now=datetime.now(UTC))


def _race(engine: Engine, *jobs: Callable[[Session], Any]) -> list[tuple[str, Any]]:
    """每个任务一个线程、一个独立会话,Barrier 放行后同时执行;返回 ("ok", 结果) / ("err", 异常)。"""
    barrier = threading.Barrier(len(jobs))
    out: list[tuple[str, Any]] = [("err", None)] * len(jobs)

    def worker(i: int, job: Callable[[Session], Any]) -> None:
        with Session(engine) as s:
            try:
                barrier.wait(timeout=WAIT)
                out[i] = ("ok", job(s))
            except Exception as e:  # noqa: BLE001 — 结果交给断言
                s.rollback()
                out[i] = ("err", e)

    threads = [threading.Thread(target=worker, args=(i, j)) for i, j in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
        assert not t.is_alive(), "线程没有在限时内结束(疑似死锁)"
    return out


def _is(result: tuple[str, Any], code: str) -> bool:
    return result[0] == "err" and isinstance(result[1], UpgradeError) and result[1].code == code


def _assert_consistent(engine: Engine) -> str:
    """库状态自洽:恰有一个进行中的学年,它与最新一次未回滚的升级对得上。返回进行中的学年名。"""
    with Session(engine) as s:
        active = s.execute(text("SELECT id, name FROM academic_years WHERE is_active")).all()
        assert len(active) == 1, active
        year = active[0]
        stray = s.execute(
            text("SELECT count(*) FROM classes WHERE active AND academic_year_id <> :y"),
            {"y": year.id},
        ).scalar_one()
        assert stray == 0
        live_bindings = s.execute(
            text(
                "SELECT count(*) FROM role_bindings WHERE ended_at IS NULL"
                " AND academic_year_id IS NOT NULL AND academic_year_id <> :y"
            ),
            {"y": year.id},
        ).scalar_one()
        assert live_bindings == 0
        ups = s.execute(
            text(
                "SELECT to_year_id FROM year_upgrades WHERE rolled_back_at IS NULL"
                " ORDER BY executed_at DESC, created_at DESC"
            )
        ).all()
        if ups:
            assert ups[0].to_year_id == year.id
        else:
            assert str(year.id) == YEAR_ID
        years = s.execute(text("SELECT count(*) FROM academic_years")).scalar_one()
        assert years == 1 + len(ups)
        return year.name


def test_two_applies_of_the_same_plan(clean):
    plan = _plan(clean)
    a, b = _race(clean, _apply(plan), _apply(plan))
    assert sorted(r[0] for r in (a, b)) == ["err", "ok"], (a, b)
    loser = a if a[0] == "err" else b
    assert _is(loser, "UPGRADE_PLAN_STALE"), loser
    with Session(clean) as s:
        assert s.execute(text("SELECT count(*) FROM year_upgrades")).scalar_one() == 1
        assert (
            s.execute(
                text("SELECT count(*) FROM academic_years WHERE name = '2027-2028'")
            ).scalar_one()
            == 1
        )
    assert _assert_consistent(clean) == "2027-2028"


def test_apply_races_rollback_from_a_clean_state(clean):
    """还没有升级记录时:apply 一定成功;rollback 要么先到(没有可回滚的),要么回滚掉刚完成的 apply。"""
    plan = _plan(clean)
    up, rb = _race(clean, _apply(plan), _rollback)
    assert up[0] == "ok", up
    if rb[0] == "ok":
        assert _assert_consistent(clean) == "2026-2027"
    else:
        assert _is(rb, "UPGRADE_NOTHING_TO_ROLLBACK"), rb
        assert _assert_consistent(clean) == "2027-2028"


def test_apply_races_rollback_of_the_previous_upgrade(clean):
    """已有一次升级(A→B)时,基于 B 的第二次 apply 与 rollback 同时进来。"""
    with Session(clean) as s:
        apply(s, SCHOOL, _plan(clean), now=datetime.now(UTC))
    second = _plan(clean, "2028-2029")
    up, rb = _race(clean, _apply(second), _rollback)
    assert rb[0] == "ok", rb  # 无论先后,回滚都能找到可回滚的升级
    if up[0] == "ok":
        # apply 先完成:回滚撤销的是它,B 重新进行中
        assert _assert_consistent(clean) == "2027-2028"
    else:
        # 回滚先完成并删掉了 B:apply 基于的学年已不在
        assert _is(up, "UPGRADE_PLAN_STALE"), up
        assert _assert_consistent(clean) == "2026-2027"


def test_two_rollbacks(clean):
    with Session(clean) as s:
        apply(s, SCHOOL, _plan(clean), now=datetime.now(UTC))
    a, b = _race(clean, _rollback, _rollback)
    assert sorted(r[0] for r in (a, b)) == ["err", "ok"], (a, b)
    loser = a if a[0] == "err" else b
    assert _is(loser, "UPGRADE_NOTHING_TO_ROLLBACK"), loser
    assert _assert_consistent(clean) == "2026-2027"
    # 回滚后可以再升级
    with Session(clean) as s:
        apply(s, SCHOOL, _plan(clean), now=datetime.now(UTC))
    assert _assert_consistent(clean) == "2027-2028"


def _wait_until_blocked(engine: Engine, count: int = 1) -> None:
    """轮询 pg_blocking_pids,直到至少 count 个会话被别的会话的锁挡住(确认对方已在等锁,不靠
    sleep)。pg_stat_activity.query 在等锁时可能还是上一条语句,所以不按语句文本过滤。"""
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


def test_apply_does_not_deadlock_with_a_class_locked_writer(clean):
    """持班级行锁的写入方(任命、加学生)随后要往带学年外键的表里插行:apply 先锁了学年行
    再去等班级锁时,二者不能互相等待(外键的 KEY SHARE 与学年行的 FOR UPDATE 会冲突)。"""
    class_id = "44444444-4444-4444-4444-444444444444"
    teacher04 = "66666666-6666-6666-6666-666666666641"
    holding, release = threading.Event(), threading.Event()
    result: dict[str, Any] = {}

    def writer() -> None:
        with Session(clean) as s:
            try:
                s.execute(text("SELECT id FROM classes WHERE id = :c FOR UPDATE"), {"c": class_id})
                holding.set()
                assert release.wait(WAIT)
                s.execute(
                    text(
                        "INSERT INTO teacher_assignments"
                        " (teacher_id, class_id, academic_year_id, identity)"
                        " VALUES (:t, :c, :y, 'assistant')"
                    ),
                    {"t": teacher04, "c": class_id, "y": YEAR_ID},
                )
                s.commit()
                result["writer"] = "ok"
            except Exception as e:  # noqa: BLE001 — 结果交给断言
                s.rollback()
                result["writer"] = e

    def upgrader() -> None:
        with Session(clean) as s:
            try:
                result["apply"] = apply(s, SCHOOL, plan, now=datetime.now(UTC))
            except Exception as e:  # noqa: BLE001
                s.rollback()
                result["apply"] = e

    plan = _plan(clean)
    tw = threading.Thread(target=writer)
    tw.start()
    assert holding.wait(WAIT)
    tu = threading.Thread(target=upgrader)
    tu.start()
    _wait_until_blocked(clean)  # apply 已拿到学年行锁,正等班级锁
    release.set()
    tw.join(WAIT)
    tu.join(WAIT)
    try:
        assert not tw.is_alive() and not tu.is_alive(), "线程没有在限时内结束(疑似死锁)"
        assert result["writer"] == "ok", result["writer"]
        assert not isinstance(result["apply"], Exception), result["apply"]
        assert _assert_consistent(clean) == "2027-2028"
    finally:
        with Session(clean) as s:
            s.execute(
                text("DELETE FROM teacher_assignments WHERE teacher_id = :t AND class_id = :c"),
                {"t": teacher04, "c": class_id},
            )
            s.commit()


def test_staff_write_queued_behind_apply_fails_and_rollback_still_works(clean):
    """apply 持班级锁期间进来的"任命班主任"在 apply 提交后才拿到锁,此时这个班已是旧学年的
    停用班:必须失败,不能给旧班写进新的在任班主任(否则之后 rollback 恢复旧任职会撞唯一索引)。"""
    from app.clock import utc_now
    from app.domain.org import staff
    from app.domain.org.schemas import StaffInput
    from app.errors import ApiError
    from app.models import SchoolClass

    class_id = UUID("44444444-4444-4444-4444-444444444444")
    teacher05_user = UUID("55555555-5555-5555-5555-555555555542")
    principal = UUID("55555555-5555-5555-5555-555555555543")
    plan = _plan(clean)
    result: dict[str, Any] = {}

    holder = Session(clean)
    holder.execute(text("SELECT id FROM classes WHERE id = :c FOR UPDATE"), {"c": class_id})

    def upgrader() -> None:
        with Session(clean) as s:
            try:
                result["apply"] = apply(s, SCHOOL, plan, now=datetime.now(UTC))
            except Exception as e:  # noqa: BLE001 — 结果交给断言
                s.rollback()
                result["apply"] = e

    def assigner() -> None:
        with Session(clean) as s:
            cls = s.get(SchoolClass, class_id)  # 路由先取到的班(此时还是在读班)
            try:
                staff.add_staff(
                    s,
                    cls,
                    StaffInput(user_id=teacher05_user, identity="homeroom"),
                    now=utc_now(),
                    actor_id=principal,
                )
                result["assign"] = "ok"
            except Exception as e:  # noqa: BLE001
                s.rollback()
                result["assign"] = e

    tu = threading.Thread(target=upgrader)
    tu.start()
    _wait_until_blocked(clean, 1)  # apply 排在第一个,等 holder 的班级锁
    ta = threading.Thread(target=assigner)
    ta.start()
    _wait_until_blocked(clean, 2)  # 任命排在第二个
    holder.rollback()
    holder.close()
    tu.join(WAIT)
    ta.join(WAIT)
    assert not tu.is_alive() and not ta.is_alive(), "线程没有在限时内结束(疑似死锁)"
    assert not isinstance(result["apply"], Exception), result["apply"]
    assign = result["assign"]
    assert isinstance(assign, ApiError) and assign.status == 404, assign
    with Session(clean) as s:  # 旧班里没有被写进新的在任班主任
        n = s.execute(
            text(
                "SELECT count(*) FROM teacher_assignments WHERE class_id = :c"
                " AND identity = 'homeroom' AND ended_at IS NULL"
            ),
            {"c": class_id},
        ).scalar_one()
        assert n == 0
        rollback(s, SCHOOL, now=datetime.now(UTC))  # 且回滚不会撞唯一索引
    assert _assert_consistent(clean) == "2026-2027"
