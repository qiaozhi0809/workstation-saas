from uuid import UUID

from sqlalchemy import select, text

from app.models import Enrollment, SchoolClass, Student
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID

BASE = f"/api/v1/classes/{CLASS_ID}"
RECORDS = f"{BASE}/students/records"

CONTACT = {"name": "王大", "relation": "父亲", "phone": "13800000001", "job": "工人"}


def _input(**over):
    body = {
        "name": "新同学",
        "gender": "女",
        "student_no": "2026099",
        "birthdate": None,
        "class_role": None,
        "tags": [],
        "boarding": False,
        "family_structure": None,
        "family_note": None,
        "learning_summary": None,
        "personality": None,
        "note": None,
        "health_notes": None,
        "contacts": [],
        "seat": None,
    }
    body.update(over)
    return body


def _seat(db, idx):
    db.expire_all()
    e = db.get(Enrollment, enrollment_of(db, STUDENT_IDS[idx]))
    return (e.seat_row, e.seat_col)


def _version(db):
    db.expire_all()
    return db.get(SchoolClass, UUID(CLASS_ID)).seat_version


def _put(client, settings, db, idx, body, user=None):
    eid = enrollment_of(db, STUDENT_IDS[idx])
    headers = auth(settings, user) if user else auth(settings)
    return client.put(f"{BASE}/students/{eid}", json=body, headers=headers)


def test_records_trimmed_by_role(client, settings, db):
    db.execute(
        text(
            "UPDATE students SET boarding = true, family_note = '外婆照顾', note = '备注', "
            "tags = ARRAY['班干部'], contacts = CAST(:c AS jsonb) WHERE id = :id"
        ),
        {"id": STUDENT_IDS[0], "c": '[{"name":"王大","relation":"父亲","phone":"1","job":""}]'},
    )
    items = client.get(RECORDS, headers=auth(settings)).json()["items"]
    assert len(items) == 10
    first = next(i for i in items if i["student_id"] == STUDENT_IDS[0])
    for key in (
        "boarding",
        "family_structure",
        "family_note",
        "contacts",
        "learning_summary",
        "personality",
        "health_notes",
        "tags",
        "note",
        "seat_locked",
    ):
        assert key in first
    assert first["contacts"][0]["name"] == "王大"
    assert first["tags"] == ["班干部"]
    other = next(i for i in items if i["student_id"] == STUDENT_IDS[3])
    assert other["contacts"] == [] and other["boarding"] is False and other["tags"] == []

    sub = client.get(RECORDS, headers=auth(settings, SUBJECT_USER_ID)).json()["items"]
    row = sub[0]
    assert {"boarding", "learning_summary", "tags"} <= set(row)
    assert not ({"contacts", "family_structure", "family_note"} & set(row))


def test_records_sorted_by_student_no(client, settings):
    items = client.get(RECORDS, headers=auth(settings)).json()["items"]
    nos = [i["student_no"] for i in items]
    present = [n for n in nos if n is not None]
    assert present == sorted(present)
    assert nos[: len(present)] == present


def test_create_student_with_contacts_and_seat_swap(client, settings, db):
    before = _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(seat={"row": 1, "col": 1}, contacts=[CONTACT], tags=["新", "新", " 班干部 "]),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["seat_row"], body["seat_col"]) == (1, 1)
    assert body["contacts"] == [CONTACT]
    assert body["tags"] == ["新", "班干部"]
    assert _seat(db, 0) == (3, 3)
    assert _version(db) == before + 1
    st = db.get(Student, UUID(body["student_id"]))
    assert st.mk.startswith("S") and len(st.mk) == 9 and st.avatar_seed == st.mk
    rows = audit_rows(db, body["enrollment_id"])
    assert [(r.action, r.success) for r in rows] == [("student.create", True)]


def test_update_student_swaps_seats(client, settings, db):
    before = _version(db)
    res = _put(client, settings, db, 0, _input(name="王小一", seat={"row": 1, "col": 2}))
    assert res.status_code == 200, res.text
    assert _seat(db, 0) == (1, 2)
    assert _seat(db, 1) == (1, 1)
    assert _version(db) == before + 1
    rows = audit_rows(db, enrollment_of(db, STUDENT_IDS[0]))
    assert [(r.action, r.success) for r in rows] == [("student.update", True)]


def test_update_same_seat_no_version_bump(client, settings, db):
    before = _version(db)
    res = _put(client, settings, db, 0, _input(name="王小一", seat={"row": 1, "col": 1}))
    assert res.status_code == 200
    assert _version(db) == before


def test_update_null_seat_clears(client, settings, db):
    before = _version(db)
    res = _put(client, settings, db, 0, _input(name="王小一", seat=None))
    assert res.status_code == 200
    assert _seat(db, 0) == (None, None)
    assert _version(db) == before + 1


def test_seat_locked_conflict(client, settings, db):
    db.execute(
        text("UPDATE enrollments SET seat_locked = true WHERE id = :id"),
        {"id": enrollment_of(db, STUDENT_IDS[1])},
    )
    before = _version(db)
    res = _put(client, settings, db, 0, _input(name="改名", seat={"row": 1, "col": 2}))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "SEAT_LOCKED"
    assert _seat(db, 0) == (1, 1) and _seat(db, 1) == (1, 2)
    assert _version(db) == before
    assert db.get(Student, UUID(STUDENT_IDS[0])).name == "王小一"


def test_seat_out_of_grid(client, settings, db):
    res = client.post(
        f"{BASE}/students", json=_input(seat={"row": 7, "col": 1}), headers=auth(settings)
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "SEAT_INVALID"
    assert res.json()["error"]["details"]["reason"] == "out_of_grid"
    n = db.scalar(select(text("count(*)")).select_from(Student))
    assert n == 10


def test_duplicate_student_no(client, settings, db):
    res = client.post(f"{BASE}/students", json=_input(student_no="2026001"), headers=auth(settings))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "DUPLICATE_STUDENT_NO"
    keep = _put(client, settings, db, 0, _input(name="王小一", student_no="2026001"))
    assert keep.status_code == 200
    clash = _put(client, settings, db, 0, _input(name="王小一", student_no="2026002"))
    assert clash.status_code == 409


def test_student_input_validation(client, settings):
    bad = [
        {"name": ""},
        {"name": "字" * 21},
        {"contacts": [CONTACT, CONTACT, CONTACT]},
        {"contacts": [{"name": "", "relation": "父", "phone": " ", "job": ""}]},
        {"tags": [f"t{i}" for i in range(13)]},
        {"gender": "M"},
        {"tags": [""]},
        {"class_role": "字" * 11},
    ]
    for over in bad:
        res = client.post(f"{BASE}/students", json=_input(**over), headers=auth(settings))
        assert res.status_code == 400, over
        assert res.json()["error"]["code"] == "BAD_REQUEST"


def test_removed_student_disappears_from_roster_and_gradebook(client, settings, db):
    eid = enrollment_of(db, STUDENT_IDS[9])
    before = _version(db)
    res = client.delete(f"{BASE}/students/{eid}", headers=auth(settings))
    assert res.status_code == 204
    h = auth(settings)
    assert len(client.get(f"{BASE}/students", headers=h).json()["items"]) == 9
    assert len(client.get(RECORDS, headers=h).json()["items"]) == 9
    book = client.get(f"{BASE}/gradebook", headers=h).json()
    assert book["exams"]
    for exam in book["exams"]:
        assert str(eid) not in exam["scores"]
        sheet = client.get(f"{BASE}/exams/{exam['id']}/scores", headers=h).json()
        assert len(sheet["items"]) == 9
    db.expire_all()
    assert db.get(Student, UUID(STUDENT_IDS[9])) is not None
    e = db.get(Enrollment, eid)
    assert e.status == "removed" and e.left_at is not None
    assert e.seat_row is None and e.seat_locked is False
    assert _version(db) == before + 1
    assert [(r.action, r.success) for r in audit_rows(db, eid)] == [("student.remove", True)]
    gone = client.get(f"/api/v1/students/{STUDENT_IDS[9]}", headers=h)
    assert gone.status_code == 404
    again = client.delete(f"{BASE}/students/{eid}", headers=h)
    assert again.status_code == 404


def test_manage_forbidden_for_subject_teacher(client, settings, db):
    h = auth(settings, SUBJECT_USER_ID)
    eid = enrollment_of(db, STUDENT_IDS[0])
    assert client.post(f"{BASE}/students", json=_input(), headers=h).status_code == 403
    assert client.put(f"{BASE}/students/{eid}", json=_input(), headers=h).status_code == 403
    assert client.delete(f"{BASE}/students/{eid}", headers=h).status_code == 403
    rows = [r for r in audit_rows(db, CLASS_ID) if r.action == "student.manage"]
    assert len(rows) == 3 and not any(r.success for r in rows)
    assert rows[0].object_type == "class"


def test_profile_has_new_fields(client, settings, db):
    db.execute(
        text(
            "UPDATE students SET boarding = true, family_note = '外婆', note = '备注', "
            "contacts = CAST(:c AS jsonb) WHERE id = :id"
        ),
        {"id": STUDENT_IDS[0], "c": '[{"name":"王大","relation":"父亲","phone":"1","job":""}]'},
    )
    body = client.get(f"/api/v1/students/{STUDENT_IDS[0]}", headers=auth(settings)).json()
    assert body["boarding"] is True
    assert body["family_note"] == "外婆"
    assert body["note"] == "备注"
    assert body["contacts"][0]["name"] == "王大"
    sub = client.get(
        f"/api/v1/students/{STUDENT_IDS[0]}", headers=auth(settings, SUBJECT_USER_ID)
    ).json()
    assert "contacts" not in sub and "family_note" not in sub
    assert sub["boarding"] is True
