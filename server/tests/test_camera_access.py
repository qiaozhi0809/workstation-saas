from datetime import UTC, datetime, time, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text

from app.domain.cameras import access
from app.domain.school_settings.service import get_switches, save_switches
from app.errors import ApiError
from app.models import User
from app.models.cameras import Camera
from app.models.timetable import Period, TimetableEntry
from app.rbac.bindings import load_bindings
from app.rbac.roles import Role
from tests.factories import bind, make_admin, make_class, make_teacher_account
from tests.helpers import auth, freeze
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    SCHOOL_ID,
    SUBJECT_USER_ID,
    TEACHER_IDS,
    TEACHER_USER_ID,
    YEAR_ID,
)

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
PARENT = "55555555-5555-5555-5555-555555555561"
G4 = "33333333-3333-3333-3333-333333333334"
C41 = "44444444-4444-4444-4444-444444444442"  # 四年一班
SCHOOL = UUID(SCHOOL_ID)

# 学校时区 Asia/Shanghai(UTC+8);2026-11-09 是周一;第 1 节 08:00–08:40
IN_PERIOD = datetime(2026, 11, 9, 0, 10, tzinfo=UTC)  # 08:10
OUT_PERIOD = datetime(2026, 11, 9, 2, 0, tzinfo=UTC)  # 10:00
CAM_URL = "rtsp://10.0.0.21/live/1"


def _monitor(db, on=True):
    sw = get_switches(db, SCHOOL)
    save_switches(db, SCHOOL, UUID(IT_ADMIN), sw.model_copy(update={"monitor": on}))


def _camera(db, name, class_id, *, enabled=True) -> Camera:
    cam = Camera(
        school_id=SCHOOL,
        name=name,
        class_id=UUID(str(class_id)) if class_id else None,
        location="教室" if class_id else "走廊",
        rtsp_url=CAM_URL,
        enabled=enabled,
    )
    db.add(cam)
    db.flush()
    return cam


def _timetable(db, class_id=CLASS_ID, teacher="teacher03"):
    db.add(Period(school_id=SCHOOL, no=1, starts_at=time(8, 0), ends_at=time(8, 40)))
    db.add(
        TimetableEntry(
            class_id=UUID(class_id),
            academic_year_id=UUID(YEAR_ID),
            weekday=1,
            period_no=1,
            subject="数学",
            teacher_id=UUID(TEACHER_IDS[teacher]),
        )
    )
    db.flush()


@pytest.fixture
def on(db):
    _monitor(db, True)


def _view(db, user_id, camera, now):
    user = db.get(User, UUID(str(user_id)))
    bindings = load_bindings(db, user.id, UUID(YEAR_ID))  # 与 get_bindings 同口径:不含家长
    return access.can_view(db, user, bindings, camera, now)


def test_can_view_matrix(db, on):
    _timetable(db)
    gh4 = make_admin(db, SCHOOL_ID, "grade_head", grade=G4)
    cams = {
        "三年二班": _camera(db, "三年二班前", CLASS_ID),
        "四年一班": _camera(db, "四年一班前", C41),
        "公共": _camera(db, "大门", None),
    }
    # (身份, 时刻) → (三年二班, 四年一班, 公共)
    table = [
        ("校长", PRINCIPAL, IN_PERIOD, ("admin", "admin", "admin")),
        ("教导主任", DEAN, IN_PERIOD, ("admin", "admin", "admin")),
        ("三年级组长", GRADE_HEAD3, IN_PERIOD, ("admin", None, None)),
        ("四年级组长", gh4.id, IN_PERIOD, (None, "admin", None)),
        ("信息中心", IT_ADMIN, IN_PERIOD, ("admin", "admin", "admin")),
        ("班主任", TEACHER_USER_ID, OUT_PERIOD, ("homeroom", None, None)),
        ("数学老师课内", SUBJECT_USER_ID, IN_PERIOD, ("period", None, None)),
        ("数学老师课外", SUBJECT_USER_ID, OUT_PERIOD, (None, None, None)),
        ("副班主任", ASSISTANT_USER_ID, IN_PERIOD, (None, None, None)),
        ("家长", PARENT, IN_PERIOD, (None, None, None)),
    ]
    for who, uid, now, expected in table:
        got = tuple(_view(db, uid, cams[k], now) for k in ("三年二班", "四年一班", "公共"))
        assert got == expected, who


def test_subject_teacher_only_in_period(db, on):
    _timetable(db)
    cam = _camera(db, "三年二班前", CLASS_ID)

    def at(h, m, day=9):
        # 学校时区 = UTC+8
        return datetime(2026, 11, day, h, m, tzinfo=UTC) - timedelta(hours=8)

    assert _view(db, SUBJECT_USER_ID, cam, at(7, 54)) is None
    assert _view(db, SUBJECT_USER_ID, cam, at(7, 55)) == "period"
    assert _view(db, SUBJECT_USER_ID, cam, at(7, 56)) == "period"
    assert _view(db, SUBJECT_USER_ID, cam, at(8, 40)) == "period"
    assert _view(db, SUBJECT_USER_ID, cam, at(8, 41)) is None
    # 星期二没有课表格子
    assert _view(db, SUBJECT_USER_ID, cam, at(8, 10, day=10)) is None


def _end_assignment(db, teacher_key, identity):
    db.execute(
        text(
            "UPDATE teacher_assignments SET ended_at = now() WHERE teacher_id = :t"
            " AND class_id = :c AND identity = :i"
        ),
        {"t": TEACHER_IDS[teacher_key], "c": CLASS_ID, "i": identity},
    )
    db.flush()


def test_ended_assignment_denied(db, on):
    _timetable(db)
    cam = _camera(db, "三年二班前", CLASS_ID)
    assert _view(db, TEACHER_USER_ID, cam, IN_PERIOD) == "homeroom"
    assert _view(db, SUBJECT_USER_ID, cam, IN_PERIOD) == "period"
    _end_assignment(db, "teacher01", "homeroom")
    _end_assignment(db, "teacher03", "subject")
    # 绑定还在,但任职已结束:仍然拒绝(R10:以任职为准)
    assert _view(db, TEACHER_USER_ID, cam, IN_PERIOD) is None
    assert _view(db, SUBJECT_USER_ID, cam, IN_PERIOD) is None


def test_disabled_camera_not_viewable(db, on):
    _timetable(db)
    cam = _camera(db, "三年二班前", CLASS_ID, enabled=False)
    pub = _camera(db, "大门", None, enabled=False)
    for uid in (DEAN, GRADE_HEAD3, TEACHER_USER_ID, SUBJECT_USER_ID):
        assert _view(db, uid, cam, IN_PERIOD) is None, uid
    assert _view(db, DEAN, pub, IN_PERIOD) is None
    # 只有 camera.manage(校长、信息中心)仍可
    assert _view(db, IT_ADMIN, cam, IN_PERIOD) == "admin"
    assert _view(db, PRINCIPAL, cam, IN_PERIOD) == "admin"


def test_ensure_monitor_on(db):
    _monitor(db, False)
    with pytest.raises(ApiError) as e:
        access.ensure_monitor_on(db, SCHOOL)
    assert e.value.status == 404
    _monitor(db, True)
    access.ensure_monitor_on(db, SCHOOL)


# ---------- HTTP ----------

CAMS = f"/api/v1/classes/{CLASS_ID}/cameras"
WALL = "/api/v1/admin/camera-wall"


def _get(client, settings, url, uid=TEACHER_USER_ID):
    return client.get(url, headers=auth(settings, uid))


def test_class_cameras_homeroom_and_period(client, db, settings, monkeypatch, on):
    _timetable(db)
    cam = _camera(db, "三年二班前", CLASS_ID)
    _camera(db, "停用的", CLASS_ID, enabled=False)
    _camera(db, "四年一班前", C41)
    freeze(monkeypatch, IN_PERIOD.isoformat())
    body = _get(client, settings, CAMS).json()
    assert body == {
        "class_id": CLASS_ID,
        "cameras": [
            {"id": str(cam.id), "name": "三年二班前", "location": "教室", "status": "idle"}
        ],
        "reason": "homeroom",
        "period": None,
    }
    body = _get(client, settings, CAMS, SUBJECT_USER_ID).json()
    assert body["reason"] == "period"
    assert body["period"] == {"no": 1, "subject": "数学", "ends_at": "08:40"}
    assert [c["id"] for c in body["cameras"]] == [str(cam.id)]
    # 副班主任能进教室但不能看:200 空列表
    res = _get(client, settings, CAMS, ASSISTANT_USER_ID)
    assert res.status_code == 200
    assert (res.json()["cameras"], res.json()["period"]) == ([], None)
    # 课外的数学老师:空列表
    freeze(monkeypatch, OUT_PERIOD.isoformat())
    res = _get(client, settings, CAMS, SUBJECT_USER_ID)
    assert (res.status_code, res.json()["cameras"]) == (200, [])
    # 校长:admin
    assert _get(client, settings, CAMS, PRINCIPAL).json()["reason"] == "admin"


def test_class_cameras_status_from_redis(client, db, settings, redis_client, on):
    cam = _camera(db, "三年二班前", CLASS_ID)
    redis_client.hset(f"ws:cam:state:{cam.id}", mapping={"status": "streaming"})
    [c] = _get(client, settings, CAMS).json()["cameras"]
    assert c["status"] == "streaming"


def test_class_cameras_empty_db_ok(client, settings, on):
    res = _get(client, settings, CAMS)
    assert res.status_code == 200
    assert res.json() == {"class_id": CLASS_ID, "cameras": [], "reason": "homeroom", "period": None}


def test_class_cameras_forbidden_cases(client, db, settings, on):
    _camera(db, "三年二班前", CLASS_ID)
    # 家长令牌:没有教职工绑定 → 403
    res = _get(client, settings, CAMS, PARENT)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")
    # 别班老师(四年一班班主任 teacher05 的账号)
    teacher05 = db.scalar(text("SELECT id FROM users WHERE login_name = 'teacher05'"))
    assert _get(client, settings, CAMS, teacher05).status_code == 403
    # 信息中心没有 class.read
    assert _get(client, settings, CAMS, IT_ADMIN).status_code == 403
    # 别校班级 / 不存在的班级 → 404(先于权限)
    assert _get(client, settings, f"/api/v1/classes/{UUID(int=7)}/cameras").status_code == 404


def test_former_teacher(client, db, settings, on):
    other = make_teacher_account(db, SCHOOL_ID, "former_t")
    bind(db, other.id, Role.subject_teacher, class_id=CLASS_ID, subject="数学", ended=True)
    # 绑定已结束:没有教室权限 → 403
    assert _get(client, settings, CAMS, other.id).status_code == 403
    # 绑定还在、任职已结束:能进教室 → 200 空列表
    cam = _camera(db, "三年二班前", CLASS_ID)
    _end_assignment(db, "teacher01", "homeroom")
    res = _get(client, settings, CAMS)
    assert (res.status_code, res.json()["cameras"]) == (200, [])
    assert cam.enabled


def test_monitor_switch_off_404(client, db, settings, on):
    cam = _camera(db, "三年二班前", CLASS_ID)
    assert len(_get(client, settings, CAMS).json()["cameras"]) == 1
    assert (
        client.get(
            f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings, TEACHER_USER_ID)
        ).json()["cameras"]
        == 1
    )
    _monitor(db, False)
    for uid, url in ((TEACHER_USER_ID, CAMS), (PRINCIPAL, WALL), (IT_ADMIN, WALL)):
        res = _get(client, settings, url, uid)
        assert (res.status_code, res.json()["error"]["code"]) == (404, "NOT_FOUND"), url
    summary = client.get(
        f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings, TEACHER_USER_ID)
    ).json()
    assert summary["cameras"] == 0
    assert cam.enabled


def test_camera_wall_grade_head_scope(client, db, settings, on):
    gh4 = make_admin(db, SCHOOL_ID, "grade_head", grade=G4)
    c32 = _camera(db, "三年二班前", CLASS_ID)
    c41 = _camera(db, "四年一班前", C41)
    _camera(db, "停用的", C41, enabled=False)
    pub = _camera(db, "大门", None)
    body = _get(client, settings, WALL, gh4.id).json()
    assert body["public"] == []
    assert [(g["grade_name"], [c["class_name"] for c in g["classes"]]) for g in body["grades"]] == [
        ("四年级", ["四年一班"])
    ]
    assert [c["id"] for c in body["grades"][0]["classes"][0]["cameras"]] == [str(c41.id)]
    assert (body["school_name"], body["timezone"]) == ("示例小学", "Asia/Shanghai")
    # 三年级组长只看三年级
    body = _get(client, settings, WALL, GRADE_HEAD3).json()
    assert [g["grade_name"] for g in body["grades"]] == ["三年级"]
    assert body["public"] == []
    # 校长 / 教导主任 / 信息中心:全部,公共区域在 public
    for uid in (PRINCIPAL, DEAN, IT_ADMIN):
        body = _get(client, settings, WALL, uid).json()
        assert [g["grade_name"] for g in body["grades"]] == ["三年级", "四年级"]
        assert [c["id"] for c in body["public"]] == [str(pub.id)]
        assert body["grades"][0]["classes"][0]["cameras"][0]["id"] == str(c32.id)


def test_camera_wall_forbidden(client, db, settings, on):
    for uid in (PARENT, TEACHER_USER_ID, SUBJECT_USER_ID, ASSISTANT_USER_ID):
        res = _get(client, settings, WALL, uid)
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN"), uid


def test_wall_orders_grades_and_classes(client, db, settings, on):
    extra = make_class(db, "三年一班x")
    _camera(db, "b", CLASS_ID)
    _camera(db, "a", extra)
    body = _get(client, settings, WALL, PRINCIPAL).json()
    names = [c["class_name"] for c in body["grades"][0]["classes"]]
    assert names == sorted(names)
