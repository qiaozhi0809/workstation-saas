"""学年升级在完整 M3a 种子上:四年级、三个班、校长 / 主任 / 组长 / 信息中心绑定都在。

本文件不用 test_years.py 里删种子的 autouse fixture。
"""

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import text

from app.domain.years.service import apply, rollback
from app.domain.years.suggest import suggest
from tests.factories import make_admin
from tests.helpers import auth
from tests.seed_ids import SCHOOL_ID, YEAR_ID

SCHOOL = UUID(SCHOOL_ID)
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER04 = "55555555-5555-5555-5555-555555555541"
TEACHER05 = "55555555-5555-5555-5555-555555555542"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"


def _plan(db):
    return suggest(db, SCHOOL, "2027-2028", date(2027, 9, 1), date(2028, 7, 15))


def _state(db):
    """逐表行数,外加会被升级 / 回滚改动的状态列。"""
    q = lambda sql: db.execute(text(sql)).all()  # noqa: E731
    return {
        "academic_years": q("SELECT id, is_active FROM academic_years ORDER BY id"),
        "grades": q("SELECT id, display_order FROM grades ORDER BY id"),
        "classes": q("SELECT id, active, homeroom_teacher_id FROM classes ORDER BY id"),
        "enrollments": q(
            "SELECT id, status, left_at, class_id, class_role FROM enrollments ORDER BY id"
        ),
        "teacher_assignments": q("SELECT id, ended_at FROM teacher_assignments ORDER BY id"),
        "role_bindings": q("SELECT id, ended_at FROM role_bindings ORDER BY id"),
        "year_upgrades": q("SELECT id FROM year_upgrades"),
    }


def _my_classes(client, settings, user):
    res = client.get("/api/v1/me/classes", headers=auth(settings, user))
    assert res.status_code == 200, res.text
    return {c["name"]: c for c in res.json()["items"]}


def test_suggest_prefills_grade_heads(db):
    plan = _plan(db)
    assert {c.from_name for c in plan.classes} == {"三年二班", "三年一班", "四年一班"}
    assert [(g.grade_name, g.user_ids) for g in plan.grade_heads] == [
        ("四年级", [UUID(GRADE_HEAD3)])
    ]


def test_suggest_grade_heads_follow_cohort_sorted_and_skip_graduating(db):
    # 三年级再来一位组长(user_id 更小的排前面);四年级组长 → 五年级;
    # 没有班的五年级、已停用的账号、整个年级毕业的组长都不列
    extra3 = make_admin(db, None, "grade_head")
    head4 = make_admin(db, None, "grade_head", grade=GRADE4_ID)
    frozen = make_admin(db, None, "grade_head")
    db.execute(text("UPDATE users SET status = 'frozen' WHERE id = :u"), {"u": frozen.id})
    db.execute(
        text(
            "INSERT INTO grades (school_id, academic_year_id, name, display_order)"
            " VALUES (:s, :y, '六年级', 6)"
        ),
        {"s": SCHOOL_ID, "y": YEAR_ID},
    )
    six = db.execute(text("SELECT id FROM grades WHERE name = '六年级'")).scalar_one()
    make_admin(db, None, "grade_head", grade=six)  # 六年级没有班:不列
    plan = _plan(db)
    assert [g.grade_name for g in plan.grade_heads] == ["四年级", "五年级"]
    assert plan.grade_heads[0].user_ids == sorted([UUID(GRADE_HEAD3), extra3.id], key=str)
    assert plan.grade_heads[1].user_ids == [head4.id]


def test_upgrade_and_rollback_on_full_seed(client, db, settings):
    before = _state(db)
    plan = _plan(db)
    assert len(plan.classes) == 3 and all(c.action == "promote" for c in plan.classes)
    homerooms_before = _my_classes(client, settings, TEACHER04)
    assert set(homerooms_before) == {"三年一班"}
    accounts_before = client.get("/api/v1/admin/accounts", headers=auth(settings, IT_ADMIN)).json()

    up = apply(db, SCHOOL, plan, now=datetime.now(UTC))
    new_year = str(up.to_year_id)
    classes = {
        r.name: r
        for r in db.execute(
            text(
                "SELECT c.id, c.name, g.name AS grade FROM classes c JOIN grades g ON g.id ="
                " c.grade_id WHERE c.academic_year_id = :y"
            ),
            {"y": new_year},
        )
    }
    assert {n: c.grade for n, c in classes.items()} == {
        "四年二班": "四年级",
        "四年一班": "四年级",
        "五年一班": "五年级",
    }

    # 新学年四年级组长是原三年级组长;校长 / 主任 / 信息中心的绑定照旧
    heads = db.execute(
        text(
            "SELECT b.user_id, g.name FROM role_bindings b JOIN grades g ON"
            " g.id::text = b.scope->>'grade_id'"
            " WHERE b.role_type = 'grade_head' AND b.ended_at IS NULL AND b.academic_year_id = :y"
        ),
        {"y": new_year},
    ).all()
    assert [(str(h.user_id), h.name) for h in heads] == [(GRADE_HEAD3, "四年级")]
    live = {
        r.role_type
        for r in db.execute(text("SELECT role_type FROM role_bindings WHERE ended_at IS NULL"))
    }
    assert {"principal", "dean", "it_admin", "grade_head", "homeroom_teacher"} <= live

    # 新学年里各入口都正常
    assert set(_my_classes(client, settings, TEACHER04)) == {"四年一班"}
    assert set(_my_classes(client, settings, TEACHER05)) == {"五年一班"}
    board = client.get("/api/v1/admin/board", headers=auth(settings, PRINCIPAL))
    assert board.status_code == 200, board.text
    assert {g["name"] for g in board.json()["grades"]} == {"四年级", "五年级"}
    assert {c["name"] for c in board.json()["classes"]} == {"四年二班", "四年一班"}
    five = next(g["id"] for g in board.json()["grades"] if g["name"] == "五年级")
    res = client.get(
        "/api/v1/admin/board", params={"grade_id": five}, headers=auth(settings, PRINCIPAL)
    )
    assert [c["name"] for c in res.json()["classes"]] == ["五年一班"]
    for user, status in ((DEAN, 200), (GRADE_HEAD3, 200), (IT_ADMIN, 403)):
        res = client.get("/api/v1/admin/board", headers=auth(settings, user))
        assert res.status_code == status, (user, res.text)
        if status == 200:
            assert {c["name"] for c in res.json()["classes"]} == {"四年二班", "四年一班"}
    accounts = client.get("/api/v1/admin/accounts", headers=auth(settings, IT_ADMIN))
    assert accounts.status_code == 200 and accounts.json()["total"] == accounts_before["total"]
    by_login = {a["login_name"]: a for a in accounts.json()["items"]}
    assert {r["label"] for r in by_login["gradehead03"]["roles"]} == {"四年级 组长"}
    assert {r["label"] for r in by_login["teacher04"]["roles"]} == {"四年一班 班主任"}

    rollback(db, SCHOOL, now=datetime.now(UTC))
    # 升级记录本身留作历史(标为已回滚),其余逐表恢复原样
    done = db.execute(text("SELECT id, rolled_back_at FROM year_upgrades")).one()
    assert done.id == up.id and done.rolled_back_at is not None
    after = _state(db)
    assert after.pop("year_upgrades") == [(up.id,)] and before.pop("year_upgrades") == []
    assert after == before
    for table in (
        "academic_years",
        "grades",
        "classes",
        "enrollments",
        "teacher_assignments",
        "role_bindings",
    ):
        assert len(after[table]) == len(before[table])
    assert _my_classes(client, settings, TEACHER04) == homerooms_before


def _heads_of(db, year_id):
    return {
        (str(r.user_id), r.name)
        for r in db.execute(
            text(
                "SELECT b.user_id, g.name FROM role_bindings b JOIN grades g ON"
                " g.id::text = b.scope->>'grade_id'"
                " WHERE b.role_type = 'grade_head' AND b.ended_at IS NULL"
                " AND b.academic_year_id = :y"
            ),
            {"y": year_id},
        )
    }


def test_grade_heads_explicit_on_full_seed(db):
    from app.domain.years.plan import GradeHeadPlan

    plan = _plan(db)
    plan.grade_heads = None  # 旧规则:gradehead03 跟到四年级
    up = apply(db, SCHOOL, plan, now=datetime.now(UTC))
    assert _heads_of(db, up.to_year_id) == {(GRADE_HEAD3, "四年级")}
    rollback(db, SCHOOL, now=datetime.now(UTC))

    plan = _plan(db)
    plan.grade_heads = [GradeHeadPlan(grade_name="四年级", user_ids=[UUID(DEAN)])]
    up = apply(db, SCHOOL, plan, now=datetime.now(UTC))
    assert _heads_of(db, up.to_year_id) == {(DEAN, "四年级")}
    assert (
        db.execute(
            text("SELECT count(*) FROM role_bindings WHERE user_id = :u AND academic_year_id = :y"),
            {"u": GRADE_HEAD3, "y": up.to_year_id},
        ).scalar_one()
        == 0
    )
