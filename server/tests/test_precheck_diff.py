"""预检结论与真实迁移结果的差分测试(L113)。

对 precheck.CHECKS 里每条 Check:建一个迁到 revision-1 的空库,用 test_precheck.DIRTY_CASES 里
同一份造数函数插入违规行,然后断言预检说的和迁移实际发生的一致——
(a) 预检报出这条 Check,行数等于造数函数承诺的数目;
(b) 真的升级到该 revision 会失败,失败信息指向这条 Check 登记的约束,库版本留在 revision-1;
(c) 删掉违规数据后预检通过,同一个迁移成功。
这样"预检漏报"(迁移会失败而预检说通过)和"预检误报"(预检说不通过而迁移其实能跑)都会变红。
"""

import re

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.deploy.precheck import CHECKS, Check, run_precheck
from tests.migrate_util import current_version, upgrade_to
from tests.test_precheck import DIRTY_CASES, _Base

Key = tuple[str, str]

# 造完数后、升级前再对数据做的修正:让迁移的失败原因只剩这条 Check 要证明的那一个。
# 0002 同座唯一的造数里有"只填了行、没填列"的行(本来就不计入该 Check),
# 它们会先撞同一个迁移里的 enrollments_seat_pair。
FIXUP_SQL: dict[Key, str] = {
    (
        "0002",
        "enrollments 同座唯一",
    ): "UPDATE enrollments SET seat_row = NULL WHERE seat_col IS NULL",
}

# 造脏数据需要去掉的是"上一版"的同名约束,而迁移自己会 DROP CONSTRAINT 它(不带 IF EXISTS):
# 造完数后把上一版约束以 NOT VALID 加回去,让迁移的 DROP 有对象可删。
RESTORE_SQL: dict[Key, str] = {
    ("0003", "enrollments 状态取值"): (
        "ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check"
        " CHECK (status IN ('active','graduated','transferred')) NOT VALID"
    ),
    ("0004", "enrollments 状态取值"): (
        "ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check"
        " CHECK (status IN ('active','graduated','transferred','removed')) NOT VALID"
    ),
}

# 迁移失败信息里不含约束名的:0008 先跑一个 DO 块,发现重复班主任就 RAISE EXCEPTION。
MARKERS: dict[Key, tuple[str, ...]] = {
    ("0008", "teacher_assignments 班主任唯一"): ("active homeroom assignments",),
}


def _previous(revision: str) -> str:
    return f"{int(revision) - 1:04d}"


def _tolerant(stmt: str) -> str:
    """DIRTY_CASES 的"去约束语句"是为 head 库写的;revision-1 时本迁移要加的约束还不存在。"""
    return re.sub(r"(DROP (?:INDEX|CONSTRAINT)) ", r"\1 IF EXISTS ", stmt)


def test_diff_covers_every_check():
    assert {(c.revision, c.name) for c in CHECKS} == set(DIRTY_CASES)
    assert set(FIXUP_SQL) | set(RESTORE_SQL) | set(MARKERS) <= set(DIRTY_CASES)


@pytest.mark.parametrize("check", CHECKS, ids=lambda c: f"{c.revision}-{c.name}")
def test_precheck_matches_migration_outcome(fresh_engine, check: Check):
    key = (check.revision, check.name)
    drops, make_dirty = DIRTY_CASES[key]
    before = _previous(check.revision)
    upgrade_to(fresh_engine, before)

    with fresh_engine.begin() as conn:
        base = _Base(conn)
        for stmt in drops:
            conn.execute(text(_tolerant(stmt)))
        expected = make_dirty(base)
        if key in FIXUP_SQL:
            conn.execute(text(FIXUP_SQL[key]))
        if key in RESTORE_SQL:
            conn.execute(text(RESTORE_SQL[key]))
        dirty_school = base.school

    # (a) 预检报出这条 Check
    report = run_precheck(fresh_engine, [check.revision])
    counts = {(c.revision, c.name): n for c, n in report.failures}
    assert counts.get(key) == expected, (counts, expected)

    # (b) 真实迁移失败,失败原因就是这条 Check 登记的约束,且整体回滚
    with pytest.raises(DBAPIError) as failure:
        upgrade_to(fresh_engine, check.revision)
    message = str(failure.value)
    markers = MARKERS.get(key, check.constraints)
    assert any(m in message for m in markers), (markers, message)
    assert current_version(fresh_engine) == before

    # (c) 删掉违规数据(整所学校连带删除),预检通过,同一个迁移成功
    with fresh_engine.begin() as conn:
        conn.execute(text("DELETE FROM schools WHERE id = :s"), {"s": dirty_school})
        _Base(conn).klass()  # 留一个正常班级,让迁移跑在非空库上
    assert run_precheck(fresh_engine, [check.revision]).ok
    upgrade_to(fresh_engine, check.revision)
    assert current_version(fresh_engine) == check.revision
