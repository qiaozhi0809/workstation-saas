from sqlalchemy import select

from app.models import Student, User
from app.models.audit import AuditLog
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, STUDENT_IDS

POOL = "/api/v1/school/tag-pool"
SAVE_POOL = "/api/v1/admin/settings/tag-pool"
SWITCHES = "/api/v1/admin/settings/switches"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
DEAN = "55555555-5555-5555-5555-555555555544"
DEFAULTS = [
    "重点关注",
    "住校",
    "留守",
    "单亲",
    "近视",
    "过敏",
    "体育特长",
    "文艺特长",
    "进步明显",
    "偏科",
    "心理关注",
    "困难帮扶",
]
SWITCH_DEFAULTS = {
    "parent_rank": False,
    "parent_negative_review": False,
    "teacher_review_frequency": False,
    "monitor": False,
    "parent_monitor": False,
    "ai_review_before_send": True,
    "star_of_week": True,
    "birthdays": True,
}


def _admin(settings):
    return auth(settings, IT_ADMIN)


def _save(client, settings, tags, renames=()):
    return client.put(
        SAVE_POOL, headers=_admin(settings), json={"tags": tags, "renames": list(renames)}
    )


def _set_tags(db, index, tags):
    db.get(Student, STUDENT_IDS[index]).tags = tags
    db.commit()


def _tags_of(db, index):
    student = db.get(Student, STUDENT_IDS[index])
    db.refresh(student)
    return student.tags


def test_tag_pool_default_and_any_user_can_read(client, settings, db):
    teacher02 = db.scalars(select(User.id).where(User.login_name == "teacher02")).one()
    res = client.get(POOL, headers=auth(settings, teacher02))
    assert res.status_code == 200
    assert res.json() == {"tags": DEFAULTS}
    assert client.get(POOL).status_code == 401


def test_tag_pool_protected(client, settings, db):
    no_boarding = [t for t in DEFAULTS if t != "住校"]
    res = _save(client, settings, no_boarding)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "TAG_PROTECTED"
    res = _save(client, settings, [*DEFAULTS, "关注"], [{"from": "重点关注", "to": "关注"}])
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "TAG_PROTECTED"
    res = _save(client, settings, DEFAULTS, [{"from": "住校", "to": "寄宿"}])
    assert res.json()["error"]["code"] == "TAG_PROTECTED"
    assert client.get(POOL, headers=_admin(settings)).json() == {"tags": DEFAULTS}


def test_tag_pool_validation(client, settings):
    assert _save(client, settings, [*DEFAULTS, "一二三四五六七八九"]).status_code == 400
    many = ["重点关注", "住校", *[f"标签{n}" for n in range(29)]]
    assert len(many) == 31
    assert _save(client, settings, many).status_code == 400
    assert _save(client, settings, [*DEFAULTS, "近视"]).status_code == 400
    assert _save(client, settings, [*DEFAULTS, "   "]).status_code == 400
    ok = _save(client, settings, [*DEFAULTS, "  新标签 "])
    assert ok.status_code == 200
    assert ok.json()["tags"][-1] == "新标签"
    edge = ["重点关注", "住校", *[f"标签{n}" for n in range(28)]]
    assert _save(client, settings, edge).status_code == 200


def test_rename_propagates_to_students(client, settings, db):
    _set_tags(db, 0, ["偏科", "近视"])
    pool = [("学科不均衡" if t == "偏科" else t) for t in DEFAULTS]
    res = _save(client, settings, pool, [{"from": "偏科", "to": "学科不均衡"}])
    assert res.status_code == 200
    assert res.json()["tags"] == pool
    assert _tags_of(db, 0) == ["学科不均衡", "近视"]
    assert client.get(POOL, headers=_admin(settings)).json() == {"tags": pool}
    audit = db.scalars(select(AuditLog).where(AuditLog.action == "settings.tag_pool")).one()
    assert audit.success is True and audit.object_type == "school_setting"
    assert audit.extra == {"renames": [{"from": "偏科", "to": "学科不均衡"}]}


def test_rename_merges_into_existing_tag(client, settings, db):
    _set_tags(db, 0, ["重点关注", "偏科"])
    _set_tags(db, 1, ["偏科", "近视", "重点关注"])
    _set_tags(db, 2, ["近视"])
    pool = [t for t in DEFAULTS if t != "偏科"]
    res = _save(client, settings, pool, [{"from": "偏科", "to": "重点关注"}])
    assert res.status_code == 200
    assert _tags_of(db, 0) == ["重点关注"]
    assert _tags_of(db, 1) == ["重点关注", "近视"]
    assert _tags_of(db, 2) == ["近视"]


def test_delete_keeps_student_tags(client, settings, db):
    _set_tags(db, 0, ["近视", "偏科"])
    pool = [t for t in DEFAULTS if t != "近视"]
    assert _save(client, settings, pool).json()["tags"] == pool
    assert _tags_of(db, 0) == ["近视", "偏科"]


def test_switches_roundtrip_and_parent_monitor_locked(client, settings):
    h = _admin(settings)
    assert client.get(SWITCHES, headers=h).json() == SWITCH_DEFAULTS
    locked = client.put(SWITCHES, headers=h, json={**SWITCH_DEFAULTS, "parent_monitor": True})
    assert locked.status_code == 400
    assert locked.json()["error"]["code"] == "BAD_REQUEST"
    assert client.get(SWITCHES, headers=h).json() == SWITCH_DEFAULTS
    new = {**SWITCH_DEFAULTS, "star_of_week": False, "monitor": True}
    assert client.put(SWITCHES, headers=h, json=new).json() == new
    assert client.get(SWITCHES, headers=h).json() == new
    again = {**new, "star_of_week": True}
    assert client.put(SWITCHES, headers=h, json=again).json() == again
    assert client.put(SWITCHES, headers=h, json={"monitor": True}).status_code == 400
    summary = client.get(f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings))
    assert summary.json()["switches"] == {"star_of_week": True, "birthdays": True}
    client.put(SWITCHES, headers=h, json={**new, "star_of_week": False})
    summary = client.get(f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings))
    assert summary.json()["switches"] == {"star_of_week": False, "birthdays": True}


def test_settings_require_permission(client, settings, db):
    h = auth(settings, DEAN)
    assert client.get(SWITCHES, headers=h).status_code == 403
    assert client.put(SWITCHES, headers=h, json=SWITCH_DEFAULTS).status_code == 403
    pool = client.put(SAVE_POOL, headers=h, json={"tags": DEFAULTS, "renames": []})
    assert pool.status_code == 403
    denied = db.scalars(select(AuditLog).where(AuditLog.success.is_(False))).all()
    assert {r.action for r in denied} == {"settings.manage"}
    assert len(denied) == 3
    assert client.put(SWITCHES, headers=_admin(settings), json=SWITCH_DEFAULTS).status_code == 200
    assert _save(client, settings, DEFAULTS).status_code == 200
    ok = db.scalars(select(AuditLog).where(AuditLog.success.is_(True))).all()
    assert {r.action for r in ok} == {"settings.switches", "settings.tag_pool"}
