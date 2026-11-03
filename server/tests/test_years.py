from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.domain.years.plan import UpgradePlan
from app.domain.years.service import UpgradeError, preview, validate
from app.domain.years.suggest import grade_index, next_class_name, next_grade, suggest
from tests.seed_ids import CLASS_ID, SCHOOL_ID, STUDENT_IDS, TEACHER_IDS, YEAR_ID

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
