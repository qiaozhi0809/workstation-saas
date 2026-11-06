"""`GET /admin/setup-checklist`:开学准备八项的完成 / 未完成判定与判权(M5d Task 10)。

判据(R17 后):school = 当前学年每个年级都显式设了学段;year = 有当前学年;classes = 当前学年 ≥ 1 班;
accounts = 除信息中心(it_admin)账号外 ≥ 1 个在用教职工账号;assignments = 每个班都有在任班主任;
timetable / cameras = 监控开关关时直接算完成(可跳过),开着时至少一个班有课表 / 至少一个摄像头;
ai = 已配置可用的 AI 服务。
判权 R6:有 org.manage 按它判,否则按 settings.manage(年级组长两者都没有 → 403)。
"""

from uuid import UUID

import pytest
from sqlalchemy import select, text

from app.ai.settings import AIConfig, save_ai_config
from app.domain.school_settings.service import get_switches, save_switches
from app.models.audit import AuditLog
from app.models.cameras import Camera
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, TEACHER_USER_ID, YEAR_ID

URL = "/api/v1/admin/setup-checklist"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
PARENT = "55555555-5555-5555-5555-555555555561"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"

KEYS = ["school", "year", "classes", "accounts", "assignments", "timetable", "cameras", "ai"]
TO = {
    "school": "/admin/org",
    "year": "/admin/upgrade",
    "classes": "/admin/org",
    "accounts": "/admin/accounts",
    "assignments": "/admin/org",
    "timetable": "/admin/timetable",
    "cameras": "/admin/cameras",
    "ai": "/admin/ai/config",
}
SKIP = "未启用监控,可跳过"
NO_AI = "不配置也能用,只是没有 AI 助手"


def items(client, settings, uid: str = IT_ADMIN) -> dict[str, dict]:
    res = client.get(URL, headers=auth(settings, uid))
    assert res.status_code == 200, res.text
    body = res.json()
    assert [i["key"] for i in body] == KEYS  # 顺序固定,前端按它渲染
    assert {i["key"]: i["to"] for i in body} == TO
    return {i["key"]: i for i in body}


def monitor_on(db) -> None:
    sw = get_switches(db, UUID(SCHOOL_ID))
    save_switches(db, UUID(SCHOOL_ID), UUID(IT_ADMIN), sw.model_copy(update={"monitor": True}))


def set_stage(db, grade_id: str, stage: str | None) -> None:
    db.execute(text("UPDATE grades SET stage = :st WHERE id = :g"), {"st": stage, "g": grade_id})


def test_seed_baseline(client, settings):
    """种子库:年级没设学段、AI 没配,其余都齐;监控关着的两项算完成并写明可跳过。"""
    got = items(client, settings)
    assert {k: v["done"] for k, v in got.items()} == {
        "school": False,
        "year": True,
        "classes": True,
        "accounts": True,
        "assignments": True,
        "timetable": True,
        "cameras": True,
        "ai": False,
    }
    assert got["school"]["detail"] == "2 个年级未设学段"
    assert got["year"]["detail"] == "当前学年 2026-2027"
    assert got["classes"]["detail"] == "已建 3 个班"
    assert got["accounts"]["detail"] == "已有 8 个教职工账号"
    assert got["assignments"]["detail"] == "3 个班都有班主任"
    assert got["timetable"]["detail"] == SKIP
    assert got["cameras"]["detail"] == SKIP
    assert got["ai"]["detail"] == NO_AI


def test_school_stage_per_grade(client, settings, db):
    set_stage(db, GRADE_ID, "小学")
    got = items(client, settings)["school"]
    assert got["done"] is False and got["detail"] == "1 个年级未设学段"
    set_stage(db, GRADE4_ID, "小学")
    got = items(client, settings)["school"]
    assert got["done"] is True and got["detail"] == "2 个年级都已设学段"


def test_no_active_year(client, settings, db):
    """没有当前学年:year 未完成,依赖学年的几项都指回去先设学年。"""
    db.execute(text("UPDATE academic_years SET is_active = false WHERE id = :y"), {"y": YEAR_ID})
    monitor_on(db)
    got = items(client, settings)
    assert got["year"]["done"] is False and got["year"]["detail"] == "还没有当前学年"
    for key in ("school", "classes", "assignments", "timetable"):
        assert got[key]["done"] is False, key
        assert got[key]["detail"] == "先设置当前学年", key


def test_fresh_year_without_grades_or_classes(client, settings, db):
    """刚建好的空学年:学年算完成,年级 / 班级 / 班主任 / 课表都还没有。"""
    db.execute(text("UPDATE academic_years SET is_active = false WHERE id = :y"), {"y": YEAR_ID})
    db.execute(
        text(
            "INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)"
            " VALUES (:s, '2027-2028', '2027-09-01', '2028-07-15', true)"
        ),
        {"s": SCHOOL_ID},
    )
    monitor_on(db)
    got = items(client, settings)
    assert got["year"]["done"] is True and got["year"]["detail"] == "当前学年 2027-2028"
    assert got["school"]["done"] is False and got["school"]["detail"] == "还没有年级"
    assert got["classes"]["done"] is False and got["classes"]["detail"] == "当前学年还没有班级"
    assert got["assignments"]["done"] is False and got["assignments"]["detail"] == "还没有班级"
    assert got["timetable"]["done"] is False and got["timetable"]["detail"] == "还没有班级排课表"


def test_accounts_exclude_it_admin(client, settings, db):
    """只剩信息中心账号时未完成;留一个校长账号就算有教职工。"""
    db.execute(
        text(
            "UPDATE users SET status = 'frozen' WHERE school_id = :s AND id <> :keep"
            " AND id IN (SELECT user_id FROM teachers)"
        ),
        {"s": SCHOOL_ID, "keep": IT_ADMIN},
    )
    got = items(client, settings)["accounts"]
    assert got["done"] is False and got["detail"] == "除管理员外还没有教职工账号"
    db.execute(text("UPDATE users SET status = 'active' WHERE id = :p"), {"p": PRINCIPAL})
    got = items(client, settings)["accounts"]
    assert got["done"] is True and got["detail"] == "已有 1 个教职工账号"


def test_accounts_count_it_admin_who_also_teaches(client, settings, db):
    """只排除"在任绑定全是 it_admin"的账号:信息中心兼班主任算教职工,纯信息中心不算。"""
    db.execute(
        text(
            "UPDATE users SET status = 'frozen' WHERE school_id = :s AND id <> :keep"
            " AND id IN (SELECT user_id FROM teachers)"
        ),
        {"s": SCHOOL_ID, "keep": IT_ADMIN},
    )
    assert items(client, settings)["accounts"]["done"] is False  # 纯信息中心
    db.execute(
        text(
            "INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id)"
            " VALUES (:u, 'homeroom_teacher', jsonb_build_object('class_id', CAST(:c AS text)), :y)"
        ),
        {"u": IT_ADMIN, "c": CLASS_ID, "y": YEAR_ID},
    )
    got = items(client, settings)["accounts"]
    assert got["done"] is True and got["detail"] == "已有 1 个教职工账号"
    # 兼任结束(绑定 ended_at 非空)后又只剩纯信息中心
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = now()"
            " WHERE user_id = :u AND role_type = 'homeroom_teacher'"
        ),
        {"u": IT_ADMIN},
    )
    assert items(client, settings)["accounts"]["done"] is False


def test_assignments_missing_homeroom(client, settings, db):
    db.execute(
        text(
            "UPDATE teacher_assignments SET ended_at = now()"
            " WHERE class_id = :c AND identity = 'homeroom' AND ended_at IS NULL"
        ),
        {"c": CLASS_ID},
    )
    got = items(client, settings)["assignments"]
    assert got["done"] is False and got["detail"] == "已建 3 个班,1 个班还没有班主任"


def test_timetable_when_monitor_on(client, settings, db):
    monitor_on(db)
    got = items(client, settings)["timetable"]
    assert got["done"] is False and got["detail"] == "还没有班级排课表"
    db.execute(
        text(
            "INSERT INTO timetable_entries"
            " (class_id, academic_year_id, weekday, period_no, subject)"
            " VALUES (:c, :y, 1, 1, '语文'), (:c, :y, 1, 2, '数学')"
        ),
        {"c": CLASS_ID, "y": YEAR_ID},
    )
    got = items(client, settings)["timetable"]
    assert got["done"] is True and got["detail"] == "1 个班有课表"


def test_cameras_when_monitor_on(client, settings, db):
    monitor_on(db)
    got = items(client, settings)["cameras"]
    assert got["done"] is False and got["detail"] == "还没有添加摄像头"
    db.add(
        Camera(
            school_id=UUID(SCHOOL_ID),
            name="三年二班前门",
            class_id=UUID(CLASS_ID),
            location="教室",
            rtsp_url="rtsp://10.0.0.21/live/1",
        )
    )
    db.flush()
    got = items(client, settings)["cameras"]
    assert got["done"] is True and got["detail"] == "已添加 1 个摄像头"


def test_ai_configured(client, settings, db):
    cfg = AIConfig(
        provider="ollama",
        base_url="http://localhost:11434/v1",
        model="qwen2.5:7b",
        temperature=0.7,
        api_key=None,
        mask_forced=False,
    )
    save_ai_config(db, settings.school_id, settings.master_key_bytes, cfg)
    got = items(client, settings)["ai"]
    assert got["done"] is True and got["detail"] == "已配置 AI 服务(qwen2.5:7b)"
    # 远程服务没填 Key:配置存在但用不了,仍算未完成
    save_ai_config(
        db,
        settings.school_id,
        settings.master_key_bytes,
        AIConfig(
            provider="custom",
            base_url="https://ai.example.test/v1",
            model="m",
            temperature=0.7,
            api_key=None,
            mask_forced=False,
        ),
    )
    got = items(client, settings)["ai"]
    assert got["done"] is False and got["detail"] == NO_AI


@pytest.mark.parametrize("uid", [IT_ADMIN, PRINCIPAL, DEAN])
def test_org_or_settings_manage_can_read(client, settings, uid):
    """信息中心(settings.manage)、校长(两者都有)、教导主任(只有 org.manage)都能读。"""
    assert client.get(URL, headers=auth(settings, uid)).status_code == 200


def test_grade_head_forbidden(client, settings, db):
    """年级组长两种权限都没有 → 403;没有 org.manage 时按 settings.manage 判,拒绝审计落在它上。"""
    res = client.get(URL, headers=auth(settings, GRADE_HEAD))
    assert res.status_code == 403, res.text
    denied = db.scalars(
        select(AuditLog).where(AuditLog.user_id == UUID(GRADE_HEAD), AuditLog.success.is_(False))
    ).all()
    assert [r.action for r in denied] == ["settings.manage"]
    assert denied[0].object_type == "school" and denied[0].object_id == SCHOOL_ID


@pytest.mark.parametrize("uid", [TEACHER_USER_ID, PARENT])
def test_teacher_and_parent_forbidden(client, settings, uid):
    assert client.get(URL, headers=auth(settings, uid)).status_code == 403


def test_requires_login(client):
    assert client.get(URL).status_code == 401
