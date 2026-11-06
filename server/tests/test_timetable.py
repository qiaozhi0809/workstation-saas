from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select, text

from app.domain.timetable import service
from app.models import SchoolClass
from app.models.timetable import Period, TimetableEntry
from tests.factories import bind, make_class, make_teacher_account
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, SCHOOL_ID, TEACHER_IDS, TEACHER_USER_ID, YEAR_ID

IT_ADMIN = "55555555-5555-5555-5555-555555555546"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"  # school.view 无 org.manage
PARENT = "55555555-5555-5555-5555-555555555561"
T_MATH = TEACHER_IDS["teacher03"]
T_HOME = TEACHER_IDS["teacher01"]
SCHOOL = UUID(SCHOOL_ID)

PERIODS = [
    {"no": 1, "starts_at": "08:00", "ends_at": "08:40"},
    {"no": 2, "starts_at": "08:50", "ends_at": "09:30"},
    {"no": 3, "starts_at": "09:50", "ends_at": "10:30"},
]


def _put_periods(client, settings, periods=None, user=IT_ADMIN):
    return client.put(
        "/api/v1/admin/periods",
        headers=auth(settings, user),
        json={"periods": PERIODS if periods is None else periods},
    )


def _put_tt(client, settings, cells, class_id=CLASS_ID, user=IT_ADMIN):
    return client.put(
        f"/api/v1/admin/classes/{class_id}/timetable",
        headers=auth(settings, user),
        json={"cells": cells},
    )


def _seed_periods(db):
    for p in PERIODS:
        h1, m1 = p["starts_at"].split(":")
        h2, m2 = p["ends_at"].split(":")
        db.add(
            Period(
                school_id=SCHOOL,
                no=p["no"],
                starts_at=datetime(2000, 1, 1, int(h1), int(m1)).time(),
                ends_at=datetime(2000, 1, 1, int(h2), int(m2)).time(),
            )
        )
    db.flush()


def _cell(db, weekday, period_no, subject, teacher_id, class_id=CLASS_ID):
    db.add(
        TimetableEntry(
            class_id=UUID(class_id),
            academic_year_id=UUID(YEAR_ID),
            weekday=weekday,
            period_no=period_no,
            subject=subject,
            teacher_id=UUID(teacher_id) if teacher_id else None,
        )
    )
    db.flush()


def _second_math_teacher(db) -> str:
    user = make_teacher_account(db, SCHOOL_ID, "math_two")
    tid = db.scalar(text("SELECT id FROM teachers WHERE user_id = :u"), {"u": user.id})
    db.execute(
        text(
            "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity,"
            " subject) VALUES (:t, :c, :y, 'subject', '数学')"
        ),
        {"t": tid, "c": CLASS_ID, "y": YEAR_ID},
    )
    db.flush()
    return str(tid)


def test_empty_db_reads(client, settings):
    res = client.get("/api/v1/periods", headers=auth(settings))
    assert res.status_code == 200 and res.json() == []
    res = client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings))
    assert res.status_code == 200
    assert res.json() == {"class_id": CLASS_ID, "class_name": "三年二班", "cells": []}


def test_current_slot_empty_periods(db):
    now = datetime(2026, 11, 9, 0, 0, tzinfo=UTC)
    assert service.current_slot(db, SCHOOL, now) is None


def test_put_periods_roundtrip_and_audit(client, settings, db):
    res = _put_periods(client, settings)
    assert res.status_code == 200 and res.json() == PERIODS
    assert client.get("/api/v1/periods", headers=auth(settings)).json() == PERIODS
    rows = audit_rows(db, SCHOOL_ID)
    assert [r.action for r in rows if r.action == "periods.update"] == ["periods.update"]
    # 再整体替换为更少的节次
    res = _put_periods(client, settings, PERIODS[:1])
    assert res.json() == PERIODS[:1]


def test_periods_overlap_rejected(client, settings, db):
    bad = [
        {"no": 1, "starts_at": "08:00", "ends_at": "08:40"},
        {"no": 2, "starts_at": "08:30", "ends_at": "09:10"},
    ]
    assert _put_periods(client, settings, bad).status_code == 400
    reversed_ = [{"no": 1, "starts_at": "08:40", "ends_at": "08:00"}]
    assert _put_periods(client, settings, reversed_).status_code == 400
    dup = [PERIODS[0], PERIODS[0]]
    assert _put_periods(client, settings, dup).status_code == 400
    too_big = [{"no": 13, "starts_at": "08:00", "ends_at": "08:40"}]
    res = _put_periods(client, settings, too_big)
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"
    assert db.scalar(select(func.count()).select_from(Period)) == 0


def test_period_in_use_409(client, settings, db):
    _seed_periods(db)
    _cell(db, 1, 3, "数学", T_MATH)
    res = _put_periods(client, settings, PERIODS[:2])
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["code"] == "PERIOD_IN_USE"
    assert "三年二班" in err["message"]
    assert err["details"]["classes"] == ["三年二班"]
    assert db.scalar(select(func.count()).select_from(Period)) == 3


def test_save_class_timetable_auto_teacher(client, settings, db):
    _seed_periods(db)
    cells = [
        {"weekday": 1, "period_no": 1, "subject": "数学"},
        {"weekday": 1, "period_no": 2, "subject": "语文"},
        {"weekday": 2, "period_no": 1, "subject": "英语", "teacher_id": None},
    ]
    res = _put_tt(client, settings, cells)
    assert res.status_code == 200, res.text
    body = res.json()
    by = {(c["weekday"], c["period_no"]): c for c in body["cells"]}
    assert by[(1, 1)]["teacher"] == {"id": T_MATH, "name": "赵老师"}
    assert by[(1, 2)]["teacher"]["id"] == T_HOME  # 班主任兼语文
    assert by[(2, 1)]["teacher"] is None  # 英语只有副班主任,无人
    assert [(c["weekday"], c["period_no"]) for c in body["cells"]] == [(1, 1), (1, 2), (2, 1)]
    assert any(r.action == "timetable.update" for r in audit_rows(db, CLASS_ID))
    # 两位数学老师 -> null
    _second_math_teacher(db)
    res = _put_tt(client, settings, [{"weekday": 3, "period_no": 1, "subject": "数学"}])
    assert res.json()["cells"][0]["teacher"] is None
    # 整班替换:旧格子没了
    assert (
        len(
            client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings)).json()[
                "cells"
            ]
        )
        == 1
    )


def test_save_class_timetable_materializes_class_subjects(client, settings, db):
    """首次写入口物化 classes.subjects(A1 的 NULL subjects 产品决定):种子班的科目列表是 NULL,
    保存课表后写成该学段的目录科目;读接口不写库。"""
    from app.domain.exams.subjects import class_subjects

    _seed_periods(db)
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    assert cls.subjects is None
    preset = [s.model_dump() for s in class_subjects(db, cls)]
    assert [s["name"] for s in preset][:3] == ["语文", "数学", "英语"]
    # 读课表不物化
    assert (
        client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings)).status_code
        == 200
    )
    db.expire_all()
    assert db.get(SchoolClass, UUID(CLASS_ID)).subjects is None

    res = _put_tt(client, settings, [{"weekday": 1, "period_no": 1, "subject": "语文"}])
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(SchoolClass, UUID(CLASS_ID)).subjects == preset
    # 再保存一次不改已物化的列表
    res = _put_tt(client, settings, [{"weekday": 1, "period_no": 2, "subject": "数学"}])
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(SchoolClass, UUID(CLASS_ID)).subjects == preset


def test_teacher_must_be_assigned(client, settings, db):
    _seed_periods(db)
    stranger = make_teacher_account(db, SCHOOL_ID, "stranger_t")
    tid = db.scalar(text("SELECT id FROM teachers WHERE user_id = :u"), {"u": stranger.id})
    cell = {"weekday": 1, "period_no": 1, "subject": "数学", "teacher_id": str(tid)}
    res = _put_tt(client, settings, [cell])
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"
    # 已结束的任课不算在任
    db.execute(
        text("UPDATE teacher_assignments SET ended_at = now() WHERE teacher_id = :t"),
        {"t": T_MATH},
    )
    cell["teacher_id"] = T_MATH
    assert _put_tt(client, settings, [cell]).status_code == 400
    # 不存在的班级科目
    bad = {"weekday": 1, "period_no": 1, "subject": "体育课X"}
    assert _put_tt(client, settings, [bad]).status_code == 400
    # 不存在的节次、重复格
    assert (
        _put_tt(client, settings, [{"weekday": 1, "period_no": 9, "subject": "语文"}]).status_code
        == 400
    )
    dup = [{"weekday": 1, "period_no": 1, "subject": "语文"}] * 2
    assert _put_tt(client, settings, dup).status_code == 400
    assert db.scalar(select(func.count()).select_from(TimetableEntry)) == 0


def test_subject_taught_by_active_teacher_allowed(client, settings, db):
    """L210:组织架构里有"信息技术"老师、考试科目表没有这门 → 仍可排课,老师自动匹配。"""
    _seed_periods(db)
    user = make_teacher_account(db, SCHOOL_ID, "it_teacher")
    tid = db.scalar(text("SELECT id FROM teachers WHERE user_id = :u"), {"u": user.id})
    db.execute(
        text(
            "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity,"
            " subject) VALUES (:t, :c, :y, 'subject', '信息技术')"
        ),
        {"t": tid, "c": CLASS_ID, "y": YEAR_ID},
    )
    db.flush()
    subjects = client.get(f"/api/v1/classes/{CLASS_ID}/subjects", headers=auth(settings)).json()
    assert "信息技术" not in {s["name"] for s in subjects["items"]}
    res = _put_tt(client, settings, [{"weekday": 1, "period_no": 1, "subject": "信息技术"}])
    assert res.status_code == 200, res.text
    assert res.json()["cells"][0]["teacher"] == {"id": str(tid), "name": user.display_name}
    # 已卸任老师的科目不算
    db.execute(
        text("UPDATE teacher_assignments SET ended_at = now() WHERE teacher_id = :t"), {"t": tid}
    )
    res = _put_tt(client, settings, [{"weekday": 1, "period_no": 2, "subject": "信息技术"}])
    assert res.status_code == 400 and "信息技术" in res.json()["error"]["message"]


def test_unassigned_teacher_error_points_at_cell(client, settings, db):
    """L211:整班保存时某格老师已卸任 → 400 的 details 带 {weekday, period_no, teacher},
    message 指出哪一格;整批不写。"""
    _seed_periods(db)
    db.execute(
        text("UPDATE teacher_assignments SET ended_at = now() WHERE teacher_id = :t"),
        {"t": T_MATH},
    )
    cells = [
        {"weekday": 1, "period_no": 1, "subject": "语文", "teacher_id": T_HOME},
        {"weekday": 3, "period_no": 2, "subject": "数学", "teacher_id": T_MATH},
    ]
    res = _put_tt(client, settings, cells)
    assert res.status_code == 400, res.text
    err = res.json()["error"]
    assert err["code"] == "BAD_REQUEST"
    assert err["details"] == {"weekday": 3, "period_no": 2, "teacher": "赵老师"}
    assert "星期三" in err["message"] and "第 2 节" in err["message"] and "赵老师" in err["message"]
    assert db.scalar(select(func.count()).select_from(TimetableEntry)) == 0
    # 不存在的 teacher_id:teacher 退回 id 字符串
    ghost = str(uuid4())
    cell = {"weekday": 1, "period_no": 1, "subject": "语文", "teacher_id": ghost}
    res = _put_tt(client, settings, [cell])
    assert res.json()["error"]["details"] == {"weekday": 1, "period_no": 1, "teacher": ghost}


def test_permissions(client, settings, db):
    other = make_class(db, "三年九班")
    homeroom_other = make_teacher_account(db, SCHOOL_ID, "home_other")
    from app.rbac.roles import Role

    bind(db, homeroom_other.id, Role.homeroom_teacher, class_id=other)
    cell = [{"weekday": 1, "period_no": 1, "subject": "语文"}]
    # 非管理员写 -> 403
    assert _put_periods(client, settings, user=TEACHER_USER_ID).status_code == 403
    assert _put_tt(client, settings, cell, user=TEACHER_USER_ID).status_code == 403
    # 没有该班 class.read 的教师读 -> 403
    res = client.get(
        f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings, homeroom_other.id)
    )
    assert res.status_code == 403
    # 本班班主任、校长可读
    for user in (TEACHER_USER_ID, PRINCIPAL):
        res = client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings, user))
        assert res.status_code == 200
    # 家长令牌:一律 403
    assert client.get("/api/v1/periods", headers=auth(settings, PARENT)).status_code == 403
    res = client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings, PARENT))
    assert res.status_code == 403
    assert _put_periods(client, settings, user=PARENT).status_code == 403
    assert _put_tt(client, settings, cell, user=PARENT).status_code == 403
    # 未登录 401
    assert client.get("/api/v1/periods").status_code == 401
    # 不存在的班级
    res = client.get(f"/api/v1/classes/{uuid4()}/timetable", headers=auth(settings))
    assert res.status_code == 404


def test_current_slot(db):
    _seed_periods(db)
    _cell(db, 1, 1, "数学", T_MATH)
    # 学校时区 Asia/Shanghai (UTC+8);2026-11-09 是周一
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 8, 23, 56, tzinfo=UTC)) == (
        1,
        1,
        datetime(2000, 1, 1, 8, 40).time(),
    )
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 9, 0, 20, tzinfo=UTC))[:2] == (1, 1)
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 9, 0, 40, tzinfo=UTC))[:2] == (1, 1)
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 9, 0, 41, tzinfo=UTC)) is None
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 8, 23, 54, tzinfo=UTC)) is None
    # 第 2 节 08:50 前 5 分钟内
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 9, 0, 46, tzinfo=UTC))[:2] == (1, 2)
    # 周日没有任何课
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 15, 0, 20, tzinfo=UTC)) is None


def test_teaches_now(db):
    _seed_periods(db)
    _cell(db, 1, 1, "数学", T_MATH)
    now = datetime(2026, 11, 9, 0, 10, tzinfo=UTC)
    cell = service.teaches_now(db, UUID(T_MATH), UUID(CLASS_ID), UUID(YEAR_ID), now)
    assert cell is not None and cell.subject == "数学" and cell.period_no == 1
    # 别的老师、课间、别的学年都不算
    assert service.teaches_now(db, UUID(T_HOME), UUID(CLASS_ID), UUID(YEAR_ID), now) is None
    late = datetime(2026, 11, 9, 1, 0, tzinfo=UTC)
    assert service.teaches_now(db, UUID(T_MATH), UUID(CLASS_ID), UUID(YEAR_ID), late) is None
    assert service.teaches_now(db, UUID(T_MATH), UUID(CLASS_ID), uuid4(), now) is None
    # 任职已结束 -> 不算(R10)
    db.execute(
        text("UPDATE teacher_assignments SET ended_at = now() WHERE teacher_id = :t"),
        {"t": T_MATH},
    )
    assert service.teaches_now(db, UUID(T_MATH), UUID(CLASS_ID), UUID(YEAR_ID), now) is None


def test_teaches_now_requires_active_year(db):
    _seed_periods(db)
    _cell(db, 1, 1, "数学", T_MATH)
    db.execute(text("UPDATE academic_years SET is_active = false WHERE id = :y"), {"y": YEAR_ID})
    now = datetime(2026, 11, 9, 0, 10, tzinfo=UTC)
    assert service.teaches_now(db, UUID(T_MATH), UUID(CLASS_ID), UUID(YEAR_ID), now) is None
    assert service.current_slot(db, SCHOOL, now) is None
    assert db.get(SchoolClass, UUID(CLASS_ID)) is not None


def test_current_slot_boundary_0755(db):
    _seed_periods(db)
    _cell(db, 1, 1, "数学", T_MATH)
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 8, 23, 55, tzinfo=UTC))[:2] == (1, 1)
    assert service.current_slot(db, SCHOOL, datetime(2026, 11, 8, 23, 54, tzinfo=UTC)) is None


def _foreign_class(db) -> UUID:
    from app.models import School

    other = School(name="外校")
    db.add(other)
    db.flush()
    cid = make_class(db, "外校一班")
    db.execute(text("UPDATE classes SET school_id = :s WHERE id = :c"), {"s": other.id, "c": cid})
    db.flush()
    return cid


def test_cross_school_class_is_404(client, settings, db):
    cid = _foreign_class(db)
    for user in (IT_ADMIN, PRINCIPAL):
        res = client.get(f"/api/v1/classes/{cid}/timetable", headers=auth(settings, user))
        assert res.status_code == 404
    cell = [{"weekday": 1, "period_no": 1, "subject": "语文"}]
    assert _put_tt(client, settings, cell, class_id=cid).status_code == 404


def test_school_view_without_org_manage_cannot_write(client, settings, db):
    _seed_periods(db)
    cell = [{"weekday": 1, "period_no": 1, "subject": "语文"}]
    assert _put_periods(client, settings, user=GRADE_HEAD).status_code == 403
    assert _put_tt(client, settings, cell, user=GRADE_HEAD).status_code == 403
    res = client.post(
        "/api/v1/admin/timetable/import",
        headers={**auth(settings, GRADE_HEAD), "Content-Type": "text/csv"},
        content="班级,星期,节次,科目,工号\n三年二班,周一,1,语文,".encode(),
    )
    assert res.status_code == 403
    assert db.scalar(select(func.count()).select_from(TimetableEntry)) == 0


def test_teaches_now_ignores_assistant_assignment(db):
    _seed_periods(db)
    t_assist = TEACHER_IDS["teacher02"]  # 副班主任,assistant 指派
    _cell(db, 1, 1, "英语", t_assist)
    now = datetime(2026, 11, 9, 0, 10, tzinfo=UTC)
    assert service.teaches_now(db, UUID(t_assist), UUID(CLASS_ID), UUID(YEAR_ID), now) is None
