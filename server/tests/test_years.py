import io
import json
from contextlib import contextmanager
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.cli import build_parser
from app.domain.years import cli as years_cli
from app.domain.years.plan import UpgradePlan
from app.domain.years.service import UpgradeError, apply, preview, rollback, validate
from app.domain.years.suggest import grade_index, next_class_name, next_grade, suggest
from tests.factories import make_class, make_student
from tests.helpers import auth
from tests.seed_ids import (
    CLASS_ID,
    SCHOOL_ID,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_IDS,
    YEAR_ID,
)

SCHOOL = UUID(SCHOOL_ID)


@pytest.mark.parametrize(
    "name,expected",
    [
        ("三年级", ("四年级", False)),
        ("六年级", (None, True)),
        ("初一", ("初二", False)),
        ("九年级", (None, True)),
        ("初三", (None, True)),
        ("七年级", ("八年级", False)),
        ("高二", ("高三", False)),
        ("高三", (None, True)),
        ("十一年级", ("十二年级", False)),
        ("十二年级", (None, True)),
        ("国际部", (None, False)),
    ],
)
def test_next_grade(name, expected):
    assert next_grade(name) == expected


@pytest.mark.parametrize(
    "name,idx",
    [("一年级", 1), ("六年级", 6), ("七年级", 7), ("初一", 7), ("初三", 9), ("高一", 10)]
    + [("十年级", 10), ("高三", 12), ("十二年级", 12), ("国际部", None)],
)
def test_grade_index(name, idx):
    assert grade_index(name) == idx


def test_next_class_name():
    assert next_class_name("三年二班", "三年级", "四年级") == "四年二班"
    assert next_class_name("初一(2)班", "初一", "初二") == "初二(2)班"
    assert next_class_name("火箭班", "三年级", "四年级") is None


def _plan(db) -> UpgradePlan:
    return suggest(db, SCHOOL, "2027-2028", date(2027, 9, 1), date(2028, 7, 15))


def _enrollment(db, student_id: str) -> UUID:
    return db.execute(
        text("SELECT id FROM enrollments WHERE student_id = :s AND status = 'active'"),
        {"s": student_id},
    ).scalar_one()


def _full_plan(db) -> UpgradePlan:
    plan = _plan(db)
    plan.new_classes.append(_new_class("三年级", "三年一班"))
    plan.students.append(
        _student(_enrollment(db, STUDENT_IDS[4]), "陈小五", "repeat", {"new_class": 0})
    )
    plan.students.append(_student(_enrollment(db, STUDENT_IDS[8]), "孙小九", "leave"))
    return plan


def _new_class(grade, name, teacher=None):
    from app.domain.years.plan import NewClassPlan

    return NewClassPlan(grade_name=grade, name=name, homeroom_teacher_id=teacher)


def _student(enrollment_id, name, action, to=None):
    from app.domain.years.plan import StudentPlan

    return StudentPlan(enrollment_id=enrollment_id, name=name, action=action, to=to)


def test_suggest_for_seed(db):
    plan = _plan(db)
    assert plan.version == 1
    assert str(plan.from_year_id) == YEAR_ID
    assert len(plan.classes) == 1
    c = plan.classes[0]
    assert (c.action, c.to_grade_name, c.to_name, str(c.homeroom_teacher_id), c.keep_teachers) == (
        "promote",
        "四年级",
        "四年二班",
        TEACHER_IDS["teacher01"],
        True,
    )
    assert c.from_name == "三年二班" and c.teacher_name == "张老师"
    assert plan.students == [] and plan.new_classes == []


def test_plan_model_rules():
    base = {
        "version": 1,
        "from_year_id": YEAR_ID,
        "new_year": {"name": "x", "start_date": "2027-09-01", "end_date": "2028-07-15"},
        "classes": [],
    }
    UpgradePlan.model_validate(base)
    bad_version = {**base, "version": 2}
    bad_dates = {**base, "new_year": {**base["new_year"], "end_date": "2027-09-01"}}
    eid = str(uuid4())
    both_to = {
        **base,
        "students": [
            {
                "enrollment_id": eid,
                "action": "repeat",
                "to": {"successor_of": CLASS_ID, "new_class": 0},
            }
        ],
    }
    no_to = {**base, "students": [{"enrollment_id": eid, "action": "repeat"}]}
    leave_to = {
        **base,
        "students": [{"enrollment_id": eid, "action": "leave", "to": {"new_class": 0}}],
    }
    for bad in (bad_version, bad_dates, both_to, no_to, leave_to):
        with pytest.raises(ValueError):
            UpgradePlan.model_validate(bad)


def test_validate_accepts_suggested_and_full_plan(db):
    validate(db, SCHOOL, _plan(db))
    validate(db, SCHOOL, _full_plan(db))


def test_preview_counts_and_warnings(db):
    pv = preview(db, SCHOOL, _full_plan(db))
    assert pv.new_year == "2027-2028"
    old = pv.classes[0]
    assert (old.from_name, old.action, old.to_label, old.teacher_name) == (
        "三年二班",
        "promote",
        "四年级 四年二班",
        "张老师",
    )
    assert (old.follow, old.repeat_out, old.leave, old.graduate, old.repeat_in) == (8, 1, 1, 0, 0)
    new = next(c for c in pv.classes if c.action == "new")
    assert new.from_name == "三年一班" and new.repeat_in == 1 and new.follow == 0
    assert new.teacher_name is None
    assert pv.new_classes == ["三年级 三年一班(班主任 未定)"]
    assert "三年一班 没有班主任" in pv.warnings
    assert not any("四年二班" in w for w in pv.warnings)


def test_preview_repeat_into_successor_and_graduate(db):
    plan = _plan(db)
    plan.classes[0].action = "graduate"
    plan.classes[0].to_grade_name = plan.classes[0].to_name = None
    plan.students.append(
        _student(
            _enrollment(db, STUDENT_IDS[0]),
            "王小一",
            "repeat",
            {"successor_of": plan.classes[0].from_class_id},
        )
    )
    # 毕业班没有后继班
    with pytest.raises(UpgradeError) as ei:
        validate(db, SCHOOL, plan)
    assert ei.value.code == "UPGRADE_PLAN_INVALID"
    plan.students.clear()
    plan.students.append(_student(_enrollment(db, STUDENT_IDS[8]), "孙小九", "leave"))
    pv = preview(db, SCHOOL, plan)
    row = pv.classes[0]
    assert row.to_label == "毕业"
    assert (row.graduate, row.follow, row.leave) == (9, 0, 1)


def test_preview_repeat_in_successor_class_of_same_grade(db):
    plan = _plan(db)
    plan.classes[0].to_grade_name = "三年级"  # 极端:原班留在同年级名,便于留级转入
    plan.classes[0].to_name = "三年二班(新)"
    plan.students.append(
        _student(
            _enrollment(db, STUDENT_IDS[0]),
            "王小一",
            "repeat",
            {"successor_of": plan.classes[0].from_class_id},
        )
    )
    pv = preview(db, SCHOOL, plan)
    row = pv.classes[0]
    assert (row.repeat_in, row.repeat_out, row.follow) == (1, 1, 9)


def _expect(db, plan, code, **details):
    with pytest.raises(UpgradeError) as ei:
        validate(db, SCHOOL, plan)
    assert ei.value.code == code
    assert ei.value.message
    for k, v in details.items():
        assert ei.value.details[k] == v, ei.value.details
    return ei.value


def test_validate_stale_empty_classes(db):
    plan = _plan(db)
    plan.classes.clear()
    _expect(db, plan, "UPGRADE_PLAN_STALE")


def test_validate_stale_wrong_year(db):
    plan = _plan(db)
    plan.from_year_id = uuid4()
    _expect(db, plan, "UPGRADE_PLAN_STALE")


def test_validate_stale_unknown_or_duplicate_class(db):
    plan = _plan(db)
    plan.classes.append(plan.classes[0].model_copy())
    _expect(db, plan, "UPGRADE_PLAN_STALE")
    plan = _plan(db)
    plan.classes[0].from_class_id = uuid4()
    _expect(db, plan, "UPGRADE_PLAN_STALE")


@pytest.mark.parametrize("field", ["to_name", "to_grade_name"])
def test_validate_promote_missing_fields(db, field):
    plan = _plan(db)
    setattr(plan.classes[0], field, None)
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="classes", index=0, field=field)


def test_validate_duplicate_class_name_in_new_grade(db):
    plan = _plan(db)
    plan.new_classes.append(_new_class("四年级", "四年二班"))
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="new_classes", index=0, field="name")
    # 同名但不同年级不算重名
    plan = _plan(db)
    plan.new_classes.append(_new_class("五年级", "四年二班"))
    validate(db, SCHOOL, plan)


def test_validate_unknown_teacher(db):
    plan = _plan(db)
    plan.classes[0].homeroom_teacher_id = uuid4()
    _expect(
        db, plan, "UPGRADE_PLAN_INVALID", section="classes", index=0, field="homeroom_teacher_id"
    )
    plan = _plan(db)
    plan.new_classes.append(_new_class("三年级", "三年一班", uuid4()))
    _expect(
        db,
        plan,
        "UPGRADE_PLAN_INVALID",
        section="new_classes",
        index=0,
        field="homeroom_teacher_id",
    )


def test_validate_enrollment_not_in_active_class(db):
    plan = _plan(db)
    plan.students.append(_student(uuid4(), "无此人", "leave"))
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="enrollment_id")


def test_validate_enrollment_not_active_status(db):
    eid = _enrollment(db, STUDENT_IDS[8])
    db.execute(text("UPDATE enrollments SET status = 'promoted' WHERE id = :i"), {"i": eid})
    plan = _plan(db)
    plan.students.append(_student(eid, "孙小九", "leave"))
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="enrollment_id")


def test_validate_same_student_twice(db):
    plan = _plan(db)
    eid = _enrollment(db, STUDENT_IDS[8])
    plan.students += [_student(eid, "孙小九", "leave"), _student(eid, "孙小九", "leave")]
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=1, field="enrollment_id")


def test_validate_repeat_target_wrong_grade(db):
    plan = _plan(db)
    plan.students.append(
        _student(
            _enrollment(db, STUDENT_IDS[4]),
            "陈小五",
            "repeat",
            {"successor_of": plan.classes[0].from_class_id},
        )
    )
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="to")
    plan = _plan(db)
    plan.new_classes.append(_new_class("四年级", "四年一班"))
    plan.students.append(
        _student(_enrollment(db, STUDENT_IDS[4]), "陈小五", "repeat", {"new_class": 0})
    )
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="to")


def test_validate_repeat_target_missing(db):
    plan = _plan(db)
    plan.students.append(
        _student(_enrollment(db, STUDENT_IDS[4]), "陈小五", "repeat", {"new_class": 3})
    )
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="to")
    plan = _plan(db)
    plan.students.append(
        _student(_enrollment(db, STUDENT_IDS[4]), "陈小五", "repeat", {"successor_of": uuid4()})
    )
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="students", index=0, field="to")


def test_validate_new_year_name_clash(db):
    plan = _plan(db)
    plan.new_year.name = "2026-2027"
    _expect(db, plan, "UPGRADE_PLAN_INVALID", section="new_year", field="name")


def test_warning_teacher_homeroom_of_two_classes(db):
    plan = _full_plan(db)
    plan.new_classes[0].homeroom_teacher_id = UUID(TEACHER_IDS["teacher01"])
    pv = preview(db, SCHOOL, plan)
    assert "张老师 同时是 四年二班、三年一班 的班主任" in pv.warnings
    assert "三年一班 没有班主任" not in pv.warnings


def test_preview_invalid_plan_raises(db):
    plan = _plan(db)
    plan.classes.clear()
    with pytest.raises(UpgradeError):
        preview(db, SCHOOL, plan)


# ---------------------------------------------------------------- apply / rollback

NOW = datetime(2027, 8, 20, 1, 0, tzinfo=UTC)


def _seed_plan(db, *, repeat=None, leave=None) -> UpgradePlan:
    plan = _plan(db)
    if repeat is not None:
        plan.new_classes.append(_new_class("三年级", "三年一班"))
        plan.students.append(
            _student(_enrollment(db, repeat), "留级生", "repeat", {"new_class": 0})
        )
    if leave is not None:
        plan.students.append(_student(_enrollment(db, leave), "转出生", "leave"))
    return plan


def _scalar(db, sql, **params):
    return db.execute(text(sql), params).scalar_one()


def _active_year(db):
    return db.execute(text("SELECT id, name FROM academic_years WHERE is_active")).one()


def _active_classes(db):
    return db.execute(
        text("SELECT id, name, seat_rows, seat_cols, seat_version FROM classes WHERE active")
    ).all()


def _roster(db, class_id):
    return [
        r.name
        for r in db.execute(
            text(
                "SELECT s.name FROM enrollments e JOIN students s ON s.id = e.student_id"
                " WHERE e.class_id = :c AND e.status = 'active' ORDER BY s.mk"
            ),
            {"c": class_id},
        )
    ]


def _seat(db, class_id, name):
    r = db.execute(
        text(
            "SELECT e.seat_row, e.seat_col, e.seat_locked, e.class_role FROM enrollments e"
            " JOIN students s ON s.id = e.student_id"
            " WHERE e.class_id = :c AND s.name = :n AND e.status = 'active'"
        ),
        {"c": class_id, "n": name},
    ).one()
    return tuple(r)


def _old_enrollment_state(db, student_id):
    r = db.execute(
        text("SELECT status, left_at FROM enrollments WHERE student_id = :s AND class_id = :c"),
        {"s": student_id, "c": CLASS_ID},
    ).one()
    return r.status, r.left_at


def _counts(db, tables):
    return {t: _scalar(db, f"SELECT count(*) FROM {t}") for t in tables}


HISTORY = ["attendances", "reviews", "exams", "scores", "growth_records", "comments"]


def test_apply_moves_students_teachers_and_bindings(db):
    names = [
        r.name for r in db.execute(text("SELECT name FROM students ORDER BY mk"))
    ]  # 王小一 … 林小十
    seats_before = {n: _seat(db, CLASS_ID, n) for n in names}
    up = apply(db, SCHOOL, _seed_plan(db, leave=STUDENT_IDS[8]), now=NOW)

    year = _active_year(db)
    assert year.name == "2027-2028" and str(year.id) == up.summary["new_year_id"]
    assert up.to_year_id == year.id and up.from_year_id == UUID(YEAR_ID)
    assert up.plan["version"] == 1 and up.rolled_back_at is None

    (new_cls,) = _active_classes(db)
    assert new_cls.name == "四年二班"
    assert (new_cls.seat_rows, new_cls.seat_cols, new_cls.seat_version) == (6, 4, 0)
    assert (
        _scalar(
            db,
            "SELECT name FROM grades WHERE id = (SELECT grade_id FROM classes WHERE id=:c)",
            c=new_cls.id,
        )
        == "四年级"
    )
    assert _scalar(db, "SELECT display_order FROM grades WHERE name = '四年级'") == 4
    assert _scalar(db, "SELECT active FROM classes WHERE id = :c", c=CLASS_ID) is False
    assert _scalar(db, "SELECT is_active FROM academic_years WHERE id = :y", y=YEAR_ID) is False
    assert _scalar(
        db, "SELECT homeroom_teacher_id FROM classes WHERE id = :c", c=new_cls.id
    ) == UUID(TEACHER_IDS["teacher01"])

    assert _roster(db, new_cls.id) == [n for n in names if n != "孙小九"]
    for n in names:
        if n != "孙小九":
            assert _seat(db, new_cls.id, n) == seats_before[n]
    assert _seat(db, new_cls.id, "王小一")[3] == "班长"
    assert _old_enrollment_state(db, STUDENT_IDS[8]) == ("transferred", NOW)
    assert _old_enrollment_state(db, STUDENT_IDS[0]) == ("promoted", NOW)
    assert up.summary["counts"] == {
        "classes": 1,
        "promoted": 9,
        "repeated": 0,
        "graduated": 0,
        "left": 1,
    }

    # 任职:旧任职结束,新班有班主任 / 数学 / 副班主任
    rows = db.execute(
        text(
            "SELECT teacher_id, identity, subject, ended_at, class_id FROM teacher_assignments"
            " WHERE academic_year_id = :y"
        ),
        {"y": year.id},
    ).all()
    assert {(str(r.teacher_id), r.identity, r.subject) for r in rows} == {
        (TEACHER_IDS["teacher01"], "homeroom", None),
        (TEACHER_IDS["teacher03"], "subject", "数学"),
        (TEACHER_IDS["teacher02"], "assistant", None),
    }
    assert all(r.ended_at is None and r.class_id == new_cls.id for r in rows)
    old = db.execute(
        text("SELECT ended_at FROM teacher_assignments WHERE academic_year_id = :y"),
        {"y": YEAR_ID},
    ).all()
    assert len(old) == 3 and all(r.ended_at == NOW for r in old)

    # 绑定
    new_b = db.execute(
        text("SELECT role_type, scope, ended_at FROM role_bindings WHERE academic_year_id = :y"),
        {"y": year.id},
    ).all()
    assert sorted(r.role_type for r in new_b) == [
        "assistant_teacher",
        "homeroom_teacher",
        "subject_teacher",
    ]
    assert all(r.scope["class_id"] == str(new_cls.id) and r.ended_at is None for r in new_b)
    assert next(r for r in new_b if r.role_type == "subject_teacher").scope["subject"] == "数学"
    old_b = db.execute(
        text("SELECT ended_at FROM role_bindings WHERE academic_year_id = :y"), {"y": YEAR_ID}
    ).all()
    assert len(old_b) == 3 and all(r.ended_at == NOW for r in old_b)
    assert len(up.summary["new_binding_ids"]) == 3 and len(up.summary["old_binding_ids"]) == 3
    assert len(up.summary["new_assignment_ids"]) == 3
    assert all(isinstance(i, str) for i in up.summary["new_class_ids"])


def test_apply_repeat_goes_unseated_without_role(db):
    up = apply(db, SCHOOL, _seed_plan(db, repeat=STUDENT_IDS[0]), now=NOW)
    assert up.summary["counts"]["repeated"] == 1 and up.summary["counts"]["classes"] == 2
    repeat_cls = _scalar(db, "SELECT id FROM classes WHERE name = '三年一班' AND active")
    assert _roster(db, repeat_cls) == ["王小一"]
    assert _seat(db, repeat_cls, "王小一") == (None, None, False, None)
    assert _old_enrollment_state(db, STUDENT_IDS[0])[0] == "promoted"
    # 新建班只有班主任任职(这里未指定班主任 → 没有任职)
    assert (
        _scalar(db, "SELECT count(*) FROM teacher_assignments WHERE class_id = :c", c=repeat_cls)
        == 0
    )


def test_apply_rejects_invalid_plan_and_changes_nothing(db):
    plan = _plan(db)
    plan.classes.clear()
    with pytest.raises(UpgradeError) as ei:
        apply(db, SCHOOL, plan, now=NOW)
    assert ei.value.code == "UPGRADE_PLAN_STALE"
    assert _active_year(db).name == "2026-2027"
    assert _scalar(db, "SELECT count(*) FROM year_upgrades") == 0


def test_upgrade_keeps_history_and_moves_access(client, settings, db):
    before = _counts(db, HISTORY)
    assert before["growth_records"] == 3 and before["comments"] >= 1 and before["exams"] == 2
    apply(db, SCHOOL, _seed_plan(db), now=NOW)
    assert _counts(db, HISTORY) == before

    h = auth(settings)  # teacher01
    classes = client.get("/api/v1/me/classes", headers=h).json()["items"]
    assert [c["name"] for c in classes] == ["四年二班"]
    new_id = classes[0]["id"]
    assert client.get(f"/api/v1/classes/{CLASS_ID}/classroom", headers=h).status_code == 403
    assert client.get(f"/api/v1/classes/{new_id}/classroom", headers=h).status_code == 200

    items = client.get(f"/api/v1/students/{STUDENT_IDS[0]}/growth-records", headers=h).json()[
        "items"
    ]
    assert len(items) == 2
    assert all(i["current_year"] is False and i["can_delete"] is False for i in items)
    assert {i["academic_year_name"] for i in items} == {"2026-2027"}

    # teacher03 在新班仍是数学任课
    body = client.get(
        f"/api/v1/classes/{new_id}/classroom", headers=auth(settings, SUBJECT_USER_ID)
    ).json()
    assert body["my_subjects"] == ["数学"]
    assert (
        client.get(
            f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings, SUBJECT_USER_ID)
        ).status_code
        == 403
    )


def test_apply_keep_teachers_false_and_copies_school_binding(db):
    principal = _scalar(db, "SELECT id FROM users WHERE login_name = 'teacher02'")
    db.execute(
        text(
            "INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id)"
            " VALUES (:u, 'principal', jsonb_build_object('school_id', cast(:s as text)), :y)"
        ),
        {"u": principal, "s": SCHOOL_ID, "y": YEAR_ID},
    )
    plan = _plan(db)
    plan.classes[0].keep_teachers = False
    up = apply(db, SCHOOL, plan, now=NOW)
    ys = str(_active_year(db).id)
    types = sorted(
        r.role_type
        for r in db.execute(
            text("SELECT role_type FROM role_bindings WHERE academic_year_id = :y"), {"y": ys}
        )
    )
    assert types == ["homeroom_teacher", "principal"]
    assert (
        _scalar(db, "SELECT count(*) FROM teacher_assignments WHERE academic_year_id = :y", y=ys)
        == 1
    )
    assert len(up.summary["new_binding_ids"]) == 2


def test_graduating_class(db):
    db.execute(text("UPDATE grades SET name = '六年级', display_order = 6"))
    up = apply(db, SCHOOL, _plan(db), now=NOW)
    assert _active_classes(db) == []
    assert (
        _scalar(db, "SELECT count(*) FROM classes WHERE academic_year_id = :y", y=up.to_year_id)
        == 0
    )
    states = {
        r.status
        for r in db.execute(
            text("SELECT status FROM enrollments WHERE class_id = :c"), {"c": CLASS_ID}
        )
    }
    assert states == {"graduated"}
    assert up.summary["counts"] == {
        "classes": 0,
        "promoted": 0,
        "repeated": 0,
        "graduated": 10,
        "left": 0,
    }


def _snapshot(db):
    return {
        "years": db.execute(text("SELECT id, is_active FROM academic_years ORDER BY id")).all(),
        "classes": db.execute(text("SELECT id, active FROM classes ORDER BY id")).all(),
        "enr": db.execute(
            text("SELECT id, status, left_at, class_id FROM enrollments ORDER BY id")
        ).all(),
        "asg": db.execute(text("SELECT id, ended_at FROM teacher_assignments ORDER BY id")).all(),
        "bind": db.execute(text("SELECT id, ended_at FROM role_bindings ORDER BY id")).all(),
        "grades": db.execute(text("SELECT id FROM grades ORDER BY id")).all(),
        "boards": db.execute(text("SELECT id FROM class_boards ORDER BY id")).all(),
    }


def test_rollback_restores_everything(db):
    before = _snapshot(db)
    history = _counts(db, HISTORY)
    up = apply(db, SCHOOL, _seed_plan(db, repeat=STUDENT_IDS[4], leave=STUDENT_IDS[8]), now=NOW)
    assert _snapshot(db) != before
    done = rollback(db, SCHOOL, now=NOW)
    assert done.id == up.id and done.rolled_back_at == NOW
    assert _snapshot(db) == before
    assert _active_year(db).name == "2026-2027"
    assert _scalar(db, "SELECT count(*) FROM academic_years") == 1
    assert _old_enrollment_state(db, STUDENT_IDS[0]) == ("active", None)
    assert _counts(db, HISTORY) == history
    assert db.execute(text("SELECT to_year_id FROM year_upgrades")).scalar_one() is None
    with pytest.raises(UpgradeError) as ei:
        rollback(db, SCHOOL, now=NOW)
    assert ei.value.code == "UPGRADE_NOTHING_TO_ROLLBACK"
    # 回滚后可以再次升级
    apply(db, SCHOOL, _plan(db), now=NOW)
    assert _active_year(db).name == "2027-2028"


def test_rollback_nothing_to_roll_back(db):
    with pytest.raises(UpgradeError) as ei:
        rollback(db, SCHOOL, now=NOW)
    assert (ei.value.code, ei.value.message) == (
        "UPGRADE_NOTHING_TO_ROLLBACK",
        "没有可以回滚的学年升级",
    )


def test_rollback_refused_when_new_year_has_data(db):
    apply(db, SCHOOL, _seed_plan(db), now=NOW)
    new_cls = _active_classes(db)[0].id
    year = _active_year(db).id
    enr = _scalar(db, "SELECT id FROM enrollments WHERE class_id = :c LIMIT 1", c=new_cls)
    db.execute(
        text(
            "INSERT INTO attendances (enrollment_id, class_id, date, status)"
            " VALUES (:e, :c, '2027-09-01', 'absent')"
        ),
        {"e": enr, "c": new_cls},
    )
    make_student(db, new_cls, "新生甲", "S9001", year_id=year)
    make_student(db, new_cls, "新生乙", "S9002", year_id=year)
    with pytest.raises(UpgradeError) as ei:
        rollback(db, SCHOOL, now=NOW)
    assert ei.value.code == "UPGRADE_HAS_DATA"
    assert ei.value.details == {"attendances": 1, "new_students": 2}
    # 数据都还在,新学年仍是当前学年
    assert _scalar(db, "SELECT count(*) FROM attendances WHERE class_id = :c", c=new_cls) == 1
    assert len(_roster(db, new_cls)) == 12
    assert _active_year(db).name == "2027-2028"
    assert db.execute(text("SELECT rolled_back_at FROM year_upgrades")).scalar_one() is None


def test_upgrade_audited(db):
    apply(db, SCHOOL, _seed_plan(db, leave=STUDENT_IDS[8]), now=NOW)
    rollback(db, SCHOOL, now=NOW)
    rows = db.execute(
        text(
            "SELECT action, user_id, object_type, extra, success FROM audit_logs"
            " WHERE action IN ('year.upgrade', 'year.rollback') ORDER BY action"
        )
    ).all()
    assert [r.action for r in rows] == ["year.rollback", "year.upgrade"]
    assert all(r.user_id is None and r.object_type == "academic_year" and r.success for r in rows)
    up = rows[1].extra
    assert up["via"] == "cli" and up["classes"] == 1 and up["promoted"] == 9 and up["left"] == 1


# ---------------------------------------------------------------- CLI


def _run_cli(db, argv):
    @contextmanager
    def factory():
        yield db

    out = io.StringIO()
    code = years_cli.run(build_parser().parse_args(["year-upgrade", *argv]), factory, out)
    return code, out.getvalue()


def _write_plan(db, tmp_path, plan=None) -> str:
    path = tmp_path / "plan.json"
    path.write_text((plan or _full_plan(db)).model_dump_json(), encoding="utf-8")
    return str(path)


def test_cli_suggest_writes_json(db, tmp_path):
    out_file = tmp_path / "plan.json"
    code, text_out = _run_cli(
        db,
        ["suggest", "--name", "2027-2028", "--start", "2027-09-01", "--end", "2028-07-15"]
        + ["--out", str(out_file)],
    )
    assert code == 0
    raw = out_file.read_text(encoding="utf-8")
    assert "四年二班" in raw and "\\u" not in raw
    plan = UpgradePlan.model_validate_json(raw)
    assert plan.new_year.name == "2027-2028"
    # 不带 --out 写标准输出
    code, text_out = _run_cli(
        db, ["suggest", "--name", "2027-2028", "--start", "2027-09-01", "--end", "2028-07-15"]
    )
    assert code == 0 and json.loads(text_out)["classes"][0]["to_name"] == "四年二班"


def test_cli_preview_output(db, tmp_path, capsys):
    code, out = _run_cli(db, ["preview", _write_plan(db, tmp_path)])
    print(out)
    assert code == 0
    lines = out.splitlines()
    assert lines[0] == "新学年:2027-2028"
    assert "三年二班 → 四年级 四年二班(班主任 张老师):随班 8、转出 1" in out
    assert "新建:三年级 三年一班(班主任 未定)" in out
    assert "警告:三年一班 没有班主任" in out
    assert _active_year(db).name == "2026-2027"


def test_cli_apply_requires_yes(db, tmp_path):
    path = _write_plan(db, tmp_path)
    code, out = _run_cli(db, ["apply", path])
    assert code == 0 and "确认无误后加 --yes 执行" in out and "新学年:2027-2028" in out
    assert _active_year(db).name == "2026-2027"
    code, out = _run_cli(db, ["apply", path, "--yes"])
    assert code == 0 and "已完成" in out
    assert _active_year(db).name == "2027-2028"


def test_cli_rollback_requires_yes(db, tmp_path):
    _run_cli(db, ["apply", _write_plan(db, tmp_path), "--yes"])
    code, out = _run_cli(db, ["rollback"])
    assert code == 0 and "确认无误后加 --yes 执行" in out
    assert _active_year(db).name == "2027-2028"
    code, out = _run_cli(db, ["rollback", "--yes"])
    assert code == 0 and "已完成" in out
    assert _active_year(db).name == "2026-2027"


def test_cli_prints_errors_with_details(db, tmp_path):
    plan = _plan(db)
    plan.classes[0].to_name = None
    code, out = _run_cli(db, ["apply", _write_plan(db, tmp_path, plan), "--yes"])
    assert code == 1
    assert out.splitlines()[0].startswith("失败:")
    assert "section: classes" in out and "field: to_name" in out
    assert _active_year(db).name == "2026-2027"
    # 回滚被拒绝时列出数量
    apply(db, SCHOOL, _plan(db), now=NOW)
    new_cls = _active_classes(db)[0].id
    enr = _scalar(db, "SELECT id FROM enrollments WHERE class_id = :c LIMIT 1", c=new_cls)
    db.execute(
        text(
            "INSERT INTO attendances (enrollment_id, class_id, date, status)"
            " VALUES (:e, :c, '2027-09-01', 'late')"
        ),
        {"e": enr, "c": new_cls},
    )
    code, out = _run_cli(db, ["rollback", "--yes"])
    assert code == 1 and "  考勤记录 1 条" in out and "新学年已有数据,不能回滚" in out


def test_cli_bad_plan_file(db, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    code, out = _run_cli(db, ["preview", str(bad)])
    assert code == 1 and out.startswith("失败:")
    code, out = _run_cli(db, ["preview", str(tmp_path / "missing.json")])
    assert code == 1 and out.startswith("失败:")


def test_cli_rollback_refused_lists_chinese_labels(db):
    apply(db, SCHOOL, _seed_plan(db), now=NOW)
    new_cls = _active_classes(db)[0].id
    year = _active_year(db).id
    enr = _scalar(db, "SELECT id FROM enrollments WHERE class_id = :c LIMIT 1", c=new_cls)
    db.execute(
        text(
            "INSERT INTO attendances (enrollment_id, class_id, date, status)"
            " VALUES (:e, :c, '2027-09-01', 'absent')"
        ),
        {"e": enr, "c": new_cls},
    )
    make_student(db, new_cls, "新生甲", "S9001", year_id=year)
    make_student(db, new_cls, "新生乙", "S9002", year_id=year)
    code, out = _run_cli(db, ["rollback", "--yes"])
    assert code == 1
    assert "  考勤记录 1 条" in out and "  新增学生 2 人" in out
    assert out.rstrip().endswith("新学年已有数据,不能回滚")
    assert "attendances" not in out and "new_students" not in out


def test_apply_same_plan_twice_is_stale(db):
    plan = _plan(db)
    apply(db, SCHOOL, plan, now=NOW)
    snap = _snapshot(db)
    with pytest.raises(UpgradeError) as ei:
        apply(db, SCHOOL, plan, now=NOW)
    assert ei.value.code == "UPGRADE_PLAN_STALE"
    assert _snapshot(db) == snap
    assert _scalar(db, "SELECT count(*) FROM year_upgrades") == 1


def test_rollback_undoes_only_latest_of_two_upgrades(db):
    apply(db, SCHOOL, _plan(db), now=NOW)
    second = suggest(db, SCHOOL, "2028-2029", date(2028, 9, 1), date(2029, 7, 15))
    apply(db, SCHOOL, second, now=datetime(2028, 8, 20, tzinfo=UTC))
    assert _active_year(db).name == "2028-2029"
    rollback(db, SCHOOL, now=datetime(2028, 8, 21, tzinfo=UTC))
    assert _active_year(db).name == "2027-2028"
    assert _scalar(db, "SELECT is_active FROM academic_years WHERE name = '2026-2027'") is False
    assert _scalar(db, "SELECT count(*) FROM academic_years") == 2
    assert [c.name for c in _active_classes(db)] == ["四年二班"]
    assert _scalar(db, "SELECT count(*) FROM year_upgrades WHERE rolled_back_at IS NULL") == 1


def _grade_head(db, scope_grade=None):
    uid = _scalar(db, "SELECT id FROM users WHERE login_name = 'teacher02'")
    db.execute(
        text(
            "INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id)"
            " VALUES (:u, 'grade_head', jsonb_build_object('grade_id', cast(:g as text)), :y)"
        ),
        {"u": uid, "g": scope_grade or "33333333-3333-3333-3333-333333333333", "y": YEAR_ID},
    )
    return uid


def _heads(db, year_id):
    return db.execute(
        text(
            "SELECT scope->>'grade_id' AS g, ended_at FROM role_bindings"
            " WHERE role_type = 'grade_head' AND academic_year_id = :y"
        ),
        {"y": year_id},
    ).all()


def test_grade_head_binding_follows_cohort_and_rolls_back(db):
    _grade_head(db)
    before = _snapshot(db)
    up = apply(db, SCHOOL, _plan(db), now=NOW)
    new_grade = _scalar(db, "SELECT id FROM grades WHERE name = '四年级'")
    new = _heads(db, up.to_year_id)
    assert [(r.g, r.ended_at) for r in new] == [(str(new_grade), None)]
    assert [r.ended_at for r in _heads(db, YEAR_ID)] == [NOW]
    ids = set(up.summary["new_binding_ids"])
    assert _scalar(
        db,
        "SELECT id FROM role_bindings WHERE role_type = 'grade_head' AND academic_year_id = :y",
        y=up.to_year_id,
    ) in {UUID(i) for i in ids}
    rollback(db, SCHOOL, now=NOW)
    assert _snapshot(db) == before
    assert [r.ended_at for r in _heads(db, YEAR_ID)] == [None]


def test_grade_head_not_copied_when_grade_graduates(db):
    db.execute(text("UPDATE grades SET name = '六年级', display_order = 6"))
    _grade_head(db)
    up = apply(db, SCHOOL, _plan(db), now=NOW)
    assert _heads(db, up.to_year_id) == []
    assert [r.ended_at for r in _heads(db, YEAR_ID)] == [NOW]


def test_grade_head_not_copied_for_grade_without_classes(db):
    other = _scalar(
        db,
        "INSERT INTO grades (school_id, academic_year_id, name, display_order)"
        " VALUES (:s, :y, '五年级', 5) RETURNING id",
        s=SCHOOL_ID,
        y=YEAR_ID,
    )
    _grade_head(db, str(other))
    up = apply(db, SCHOOL, _plan(db), now=NOW)
    assert _heads(db, up.to_year_id) == []
    assert [r.ended_at for r in _heads(db, YEAR_ID)] == [NOW]


def test_grade_head_follows_majority_grade(db):
    # 同一年级下三个班:两班升入"四年级",一班升入"五年级" → 跟"四年级"
    for name in ("三年一班", "三年三班"):
        make_class(db, name)
    plan = _plan(db)
    assert len(plan.classes) == 3
    plan.classes.sort(key=lambda c: c.from_name)
    for c, (g, n) in zip(
        plan.classes,
        [("四年级", "四年一班"), ("四年级", "四年二班"), ("五年级", "五年三班")],
        strict=True,
    ):
        c.to_grade_name, c.to_name = g, n
    _grade_head(db)
    up = apply(db, SCHOOL, plan, now=NOW)
    four = _scalar(
        db, "SELECT id FROM grades WHERE name = '四年级' AND academic_year_id = :y", y=up.to_year_id
    )
    assert [r.g for r in _heads(db, up.to_year_id)] == [str(four)]


def test_grade_head_majority_tie_prefers_lower_grade(db):
    make_class(db, "三年一班")
    plan = _plan(db)
    plan.classes.sort(key=lambda c: c.from_name)
    plan.classes[0].to_grade_name, plan.classes[0].to_name = "五年级", "五年一班"
    plan.classes[1].to_grade_name, plan.classes[1].to_name = "四年级", "四年二班"
    _grade_head(db)
    up = apply(db, SCHOOL, plan, now=NOW)
    four = _scalar(
        db, "SELECT id FROM grades WHERE name = '四年级' AND academic_year_id = :y", y=up.to_year_id
    )
    assert [r.g for r in _heads(db, up.to_year_id)] == [str(four)]
