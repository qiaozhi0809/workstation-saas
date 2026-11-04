from datetime import date
from uuid import UUID

from sqlalchemy import select, text

from app.domain.comments.service import semester_of
from app.models import AcademicYear, ClassBoard, RoleBinding, SchoolClass, SeatArrangement
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, TEACHER_USER_ID, YEAR_ID

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER04 = "55555555-5555-5555-5555-555555555541"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"
API = "/api/v1/admin"


def _actions(db, object_id, action):
    return [r for r in audit_rows(db, object_id) if r.action == action]


def _grade_body(name="五年级", stage=None, order=5):
    return {"name": name, "stage": stage, "display_order": order}


def _create_grade(client, settings, **kw):
    res = client.post(f"{API}/grades", json=_grade_body(**kw), headers=auth(settings, PRINCIPAL))
    assert res.status_code == 201, res.text
    return res.json()


def _create_class(client, settings, grade_id, name="五年一班", room="求知楼 501"):
    body = {"grade_id": grade_id, "name": name, "room": room}
    res = client.post(f"{API}/classes", json=body, headers=auth(settings, PRINCIPAL))
    assert res.status_code == 201, res.text
    return res.json()


def test_org_requires_permission(client, db, settings):
    for uid in (TEACHER_USER_ID, GRADE_HEAD):
        assert client.get(f"{API}/grades", headers=auth(settings, uid)).status_code == 403
    denied = [r for r in _actions(db, SCHOOL_ID, "org.manage") if not r.success]
    assert len(denied) == 2
    assert client.get(f"{API}/grades", headers=auth(settings, IT_ADMIN)).status_code == 200


def test_school_get_any_admin_context_put_needs_org_manage(client, db, settings):
    res = client.get(f"{API}/school", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200
    assert res.json() == {"name": "示例小学", "address": None}
    for uid in (DEAN, GRADE_HEAD, IT_ADMIN):
        assert client.get(f"{API}/school", headers=auth(settings, uid)).status_code == 200
    assert client.get(f"{API}/school", headers=auth(settings, TEACHER_USER_ID)).status_code == 403
    body = {"name": "示例实验小学", "address": "示例路 1 号"}
    # 年级组长有管理语境、能读,但没有 org.manage,不能写
    assert (
        client.put(f"{API}/school", json=body, headers=auth(settings, GRADE_HEAD)).status_code
        == 403
    )
    res = client.put(f"{API}/school", json=body, headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200 and res.json() == body
    assert client.get(f"{API}/school", headers=auth(settings, DEAN)).json() == body
    assert _actions(db, SCHOOL_ID, "org.school")[0].success
    for bad in ({"name": "", "address": None}, {"name": "校" * 41, "address": None}):
        assert (
            client.put(f"{API}/school", json=bad, headers=auth(settings, IT_ADMIN)).status_code
            == 400
        )


def test_years_list_and_update_term2_validation(client, db, settings):
    res = client.get(f"{API}/years", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 200
    years = res.json()
    assert years[0]["id"] == YEAR_ID and years[0]["is_active"] is True
    body = {
        "name": "2026-2027",
        "start_date": "2026-09-01",
        "end_date": "2027-07-15",
        "term2_start": "2026-08-01",
    }
    h = auth(settings, PRINCIPAL)
    assert client.put(f"{API}/years/{YEAR_ID}", json=body, headers=h).status_code == 400
    body["term2_start"] = "2027-07-15"
    assert client.put(f"{API}/years/{YEAR_ID}", json=body, headers=h).status_code == 400
    body["term2_start"] = "2027-01-05"
    res = client.put(f"{API}/years/{YEAR_ID}", json=body, headers=h)
    assert res.status_code == 200 and res.json()["term2_start"] == "2027-01-05"
    year = db.get(AcademicYear, UUID(YEAR_ID))
    assert semester_of(year, date(2027, 1, 10)).endswith("第二学期")
    body["term2_start"] = None
    assert client.put(f"{API}/years/{YEAR_ID}", json=body, headers=h).status_code == 200
    assert _actions(db, YEAR_ID, "org.year")
    body["start_date"], body["end_date"] = "2027-07-15", "2026-09-01"
    assert client.put(f"{API}/years/{YEAR_ID}", json=body, headers=h).status_code == 400


def test_grade_crud_and_not_empty(client, db, settings):
    h = auth(settings, PRINCIPAL)
    listed = client.get(f"{API}/grades", headers=h).json()
    assert [g["name"] for g in listed] == ["三年级", "四年级"]
    assert listed[0]["class_count"] == 2 and listed[0]["effective_stage"] == "小学"
    created = _create_grade(client, settings)
    assert created["class_count"] == 0 and created["stage"] is None
    assert _actions(db, created["id"], "org.grade_create")
    dup = client.post(f"{API}/grades", json=_grade_body(), headers=h)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "NAME_TAKEN"
    upd = client.put(
        f"{API}/grades/{created['id']}", json=_grade_body("五年级", "初中", 6), headers=h
    )
    assert upd.status_code == 200 and upd.json()["effective_stage"] == "初中"
    assert _actions(db, created["id"], "org.grade_update")
    clash = client.put(f"{API}/grades/{created['id']}", json=_grade_body("三年级"), headers=h)
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "NAME_TAKEN"
    full = client.delete(f"{API}/grades/{GRADE_ID}", headers=h)
    assert full.status_code == 409 and full.json()["error"]["code"] == "GRADE_NOT_EMPTY"
    assert client.delete(f"{API}/grades/{created['id']}", headers=h).status_code == 204
    assert _actions(db, created["id"], "org.grade_delete")
    assert client.delete(f"{API}/grades/{created['id']}", headers=h).status_code == 404


def test_grade_stage_drives_default_subjects(client, settings):
    h = auth(settings, PRINCIPAL)
    before = client.get(f"/api/v1/classes/{CLASS_ID}/subjects", headers=auth(settings)).json()
    assert [s["name"] for s in before["items"]] == ["语文", "数学", "英语", "科学", "道法"]
    res = client.put(f"{API}/grades/{GRADE_ID}", json=_grade_body("三年级", "初中", 3), headers=h)
    assert res.status_code == 200
    after = client.get(f"/api/v1/classes/{CLASS_ID}/subjects", headers=auth(settings)).json()
    assert "物理" in [s["name"] for s in after["items"]]
    assert after["items"][0]["full"] == 120


def test_create_class_defaults(client, db, settings):
    cls = _create_class(client, settings, GRADE_ID, "三年三班", "求知楼 203")
    assert cls["desk_size"] == 2 and cls["seat_layout"] == "auto"
    assert (cls["seat_rows"], cls["seat_cols"]) == (6, 8)
    assert cls["student_count"] == 0 and cls["homeroom"] is None and cls["assistants"] == []
    assert cls["grade_name"] == "三年级" and cls["subjects"] == []
    assert _actions(db, cls["id"], "org.class_create")
    h = auth(settings, PRINCIPAL)
    body = {"grade_id": GRADE_ID, "name": "三年四班", "room": "室" * 31}
    assert client.post(f"{API}/classes", json=body, headers=h).status_code == 400
    dup = client.post(
        f"{API}/classes", json={"grade_id": GRADE_ID, "name": "三年三班", "room": ""}, headers=h
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "NAME_TAKEN"


def test_list_and_get_classes(client, settings):
    h = auth(settings, PRINCIPAL)
    allc = client.get(f"{API}/classes", headers=h).json()
    assert {c["name"] for c in allc} == {"三年二班", "三年一班", "四年一班"}
    g4 = client.get(f"{API}/classes?grade_id={GRADE4_ID}", headers=h).json()
    assert [c["name"] for c in g4] == ["四年一班"]
    one = client.get(f"{API}/classes/{CLASS_ID}", headers=h).json()
    assert one["student_count"] == 10
    assert one["homeroom"]["display_name"] == "张老师"
    assert [a["display_name"] for a in one["assistants"]] == ["王老师"]
    assert one["subjects"][0]["subject"] == "数学"
    assert one["subjects"][0]["teachers"][0]["display_name"] == "赵老师"


def test_rename_class_shows_in_my_classes(client, db, settings):
    h = auth(settings, PRINCIPAL)
    body = {"grade_id": GRADE_ID, "name": "三年九班", "room": "求知楼 299"}
    res = client.put(f"{API}/classes/{CLASS_ID}", json=body, headers=h)
    assert res.status_code == 200 and res.json()["name"] == "三年九班"
    mine = client.get("/api/v1/me/classes", headers=auth(settings)).json()["items"]
    assert mine[0]["name"] == "三年九班" and mine[0]["room"] == "求知楼 299"
    assert _actions(db, CLASS_ID, "org.class_update")
    clash = {"grade_id": GRADE_ID, "name": "三年一班", "room": ""}
    assert client.put(f"{API}/classes/{CLASS_ID}", json=clash, headers=h).status_code == 409


def test_delete_class_with_data_rejected(client, db, settings):
    h = auth(settings, PRINCIPAL)
    res = client.delete(f"{API}/classes/{CLASS_ID}", headers=h)
    assert res.status_code == 409 and res.json()["error"]["code"] == "CLASS_NOT_EMPTY"
    cls = _create_class(client, settings, GRADE_ID, "三年五班")
    db.execute(
        text(
            "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity)"
            " VALUES ('66666666-6666-6666-6666-666666666643', :c, :y, 'assistant')"
        ),
        {"c": cls["id"], "y": YEAR_ID},
    )
    db.add(
        RoleBinding(
            user_id=UUID("55555555-5555-5555-5555-555555555543"),
            role_type="assistant_teacher",
            scope={"class_id": cls["id"]},
            academic_year_id=UUID(YEAR_ID),
        )
    )
    db.flush()
    assert client.delete(f"{API}/classes/{cls['id']}", headers=h).status_code == 204
    assert db.get(SchoolClass, UUID(cls["id"])) is None
    open_bindings = db.scalars(
        select(RoleBinding).where(
            RoleBinding.scope["class_id"].astext == cls["id"], RoleBinding.ended_at.is_(None)
        )
    ).all()
    assert open_bindings == []
    assert _actions(db, cls["id"], "org.class_delete")
    assert client.get(f"{API}/classes/{cls['id']}", headers=h).status_code == 404


def test_delete_class_cascades_seat_snapshots_and_board(client, db, settings):
    cls = _create_class(client, settings, GRADE_ID, "三年六班")
    cid = UUID(cls["id"])
    db.add(SeatArrangement(class_id=cid, version=1, seat_rows=6, seat_cols=8, layout=[]))
    db.add(ClassBoard(class_id=cid))
    db.flush()
    res = client.delete(f"{API}/classes/{cid}", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 204
    for model in (SeatArrangement, ClassBoard):
        assert db.scalars(select(model).where(model.class_id == cid)).all() == []
