from uuid import UUID

from sqlalchemy import select, text

from app.models import Enrollment, SchoolClass, SeatArrangement, Student
from tests.factories import make_student
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
    assert n == 22


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


def test_full_grid_new_student_displaces_occupant_to_unseated(client, settings, db):
    rows, cols = db.execute(
        text("SELECT seat_rows, seat_cols FROM classes WHERE id = :i"), {"i": CLASS_ID}
    ).one()
    eids = [enrollment_of(db, s) for s in STUDENT_IDS]
    # 清空后铺满整个座位表:先给已有 10 人,其余格子用额外学生占满
    db.execute(text("UPDATE enrollments SET seat_row = NULL, seat_col = NULL, seat_locked = false"))
    cells = [(r, c) for r in range(1, rows + 1) for c in range(1, cols + 1)]
    assert len(cells) >= len(eids)
    for eid, (r, c) in zip(eids, cells, strict=False):
        db.execute(
            text("UPDATE enrollments SET seat_row = :r, seat_col = :c WHERE id = :i"),
            {"r": r, "c": c, "i": eid},
        )
    for n, (r, c) in enumerate(cells[len(eids) :]):
        res = client.post(
            f"{BASE}/students",
            json=_input(name=f"填充{n}", student_no=f"F{n}", seat={"row": r, "col": c}),
            headers=auth(settings),
        )
        assert res.status_code == 201, res.text
    before = _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 1, "col": 1}),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (1, 1)
    assert _seat(db, 0) == (None, None)
    assert _version(db) == before + 1


def _cls(db):
    db.expire_all()
    return db.get(SchoolClass, UUID(CLASS_ID))


def _setup_grid(db, *, rows, cols, seats, layout="auto", desk=2, order="row", podium=(0, 0)):
    """把种子班改成指定行列,并按 seats 给在读同学逐个排座(多出的座位由新建学生补人)。"""
    cls = _cls(db)
    cls.seat_rows, cls.seat_cols, cls.desk_size = rows, cols, desk
    cls.seat_layout, cls.seat_order = layout, order
    cls.podium_left, cls.podium_right = podium
    db.execute(text("UPDATE enrollments SET seat_row = NULL, seat_col = NULL, seat_locked = false"))
    eids = [enrollment_of(db, s) for s in STUDENT_IDS]
    for n in range(max(0, len(seats) - len(eids))):
        sid = make_student(db, cls.id, f"填充{n:03d}", f"P{n:03d}", student_no=f"2027{n:03d}")
        eids.append(enrollment_of(db, sid))
    for eid, (r, c) in zip(eids, seats, strict=False):
        db.execute(
            text("UPDATE enrollments SET seat_row = :r, seat_col = :c WHERE id = :i"),
            {"r": r, "c": c, "i": eid},
        )
    db.flush()
    db.commit()
    return eids


def _seats_by_eid(db):
    db.expire_all()
    rows = db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == UUID(CLASS_ID), Enrollment.status == "active"
        )
    ).all()
    return {e.id: (e.seat_row, e.seat_col) for e in rows}


def _row_major(rows, cols):
    return [(r, c) for r in range(1, rows + 1) for c in range(1, cols + 1)]


def test_auto_class_adds_row_when_full(client, settings, db):
    eids = _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4))
    before_seats = _seats_by_eid(db)
    before = _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=True),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert _cls(db).seat_rows == 5
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (5, 1)
    now = _seats_by_eid(db)
    assert all(now[e] == before_seats[e] for e in eids)
    assert _version(db) > before


def test_auto_seat_false_leaves_unseated_but_still_reflows(client, settings, db):
    _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4))
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=False),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert _cls(db).seat_rows == 5
    assert res.json()["seat_row"] is None and res.json()["seat_col"] is None


def test_manual_class_never_reflows(client, settings, db):
    assert _cls(db).seat_layout == "manual" and _cls(db).seat_rows == 6
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=True),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert _cls(db).seat_rows == 6


def test_remove_shrinks_rows_and_moves_last_row(client, settings, db):
    # 1~4 排坐满 16 人,第 5 排只有一位同学且被固定;删掉 (1,1) 的同学后只剩 16 人,缩成 4 排
    seats = [*_row_major(4, 4), (5, 1)]
    eids = _setup_grid(db, rows=5, cols=4, seats=seats)
    last = eids[16]
    db.execute(text("UPDATE enrollments SET seat_locked = true WHERE id = :i"), {"i": last})
    db.commit()
    before = _version(db)
    snaps = db.scalar(text("SELECT count(*) FROM seat_arrangements"))
    res = client.delete(f"{BASE}/students/{eids[0]}", headers=auth(settings))
    assert res.status_code == 204
    c = _cls(db)
    assert (c.seat_rows, c.seat_cols) == (4, 4)
    now = _seats_by_eid(db)
    assert eids[0] not in now and len(now) == 16
    assert now[last] == (1, 1)  # 最前的空位
    assert db.get(Enrollment, last).seat_locked is False
    assert len(set(now.values())) == 16  # 没有两人同座
    assert all(s is not None and 1 <= s[0] <= 4 and 1 <= s[1] <= 4 for s in now.values())
    for e in eids[1:16]:  # 其他人原地不动
        assert now[e] == seats[eids.index(e)]
    assert _version(db) == before + 1
    assert db.scalar(text("SELECT count(*) FROM seat_arrangements")) == snaps + 1


def test_remove_moves_whole_last_row_in_order(client, settings, db):
    # 最后一排两人(其中一位被固定):按原左右顺序依次进空位,谁也不丢、不同座
    seats = [*_row_major(4, 4), (5, 1), (5, 2)]
    eids = _setup_grid(db, rows=5, cols=4, seats=seats)
    db.execute(text("UPDATE enrollments SET seat_locked = true WHERE id = :i"), {"i": eids[17]})
    db.commit()
    for gone in (eids[0], eids[1]):
        assert client.delete(f"{BASE}/students/{gone}", headers=auth(settings)).status_code == 204
    c = _cls(db)
    assert c.seat_rows == 4
    now = _seats_by_eid(db)
    assert len(now) == 16 and len(set(now.values())) == 16
    assert now[eids[16]] == (1, 1) and now[eids[17]] == (1, 2)
    assert not db.get(Enrollment, eids[17]).seat_locked


def test_create_student_on_podium_seat(client, settings, db):
    _setup_grid(db, rows=6, cols=4, seats=[], layout="manual", podium=(2, 0))
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 0, "col": -2}),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (0, -2)
    for bad in ({"row": 0, "col": 1}, {"row": 0, "col": 0}):
        res = client.post(
            f"{BASE}/students",
            json=_input(student_no="N2", seat=bad),
            headers=auth(settings),
        )
        assert res.status_code == 400, res.text
        assert res.json()["error"]["code"] == "SEAT_INVALID"
        assert res.json()["error"]["details"]["reason"] == "podium_unavailable"
    assert (
        client.post(
            f"{BASE}/students",
            json=_input(student_no="N3", seat={"row": 0, "col": -3}),
            headers=auth(settings),
        ).status_code
        == 400
    )


def test_podium_seat_can_be_swap_target(client, settings, db):
    _setup_grid(db, rows=6, cols=4, seats=[(0, -1), (1, 1)], layout="manual", podium=(1, 0))
    res = _put(client, settings, db, 1, _input(name="王小二", seat={"row": 0, "col": -1}))
    assert res.status_code == 200, res.text
    assert _seat(db, 1) == (0, -1)
    assert _seat(db, 0) == (1, 1)  # 互换:原讲台同学去了对方的座位


def test_podium_student_not_counted_for_auto_rows(client, settings, db):
    # 15 个普通座位有人 + 讲台 (0,-1) 一人 = 16 人;再加 1 人,需要排进普通座位的是 16 人,仍 4 排
    seats = [*_row_major(4, 4)[:15], (0, -1)]
    _setup_grid(db, rows=4, cols=4, seats=seats, podium=(1, 0))
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=True),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert _cls(db).seat_rows == 4
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (4, 4)


def test_first_empty_follows_seat_order(client, settings, db):
    _setup_grid(db, rows=6, cols=4, seats=[(1, 1)], layout="manual", desk=1, order="col")
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=True),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (2, 1)


def test_auto_seat_ignored_on_update_and_when_seat_given(client, settings, db):
    _setup_grid(db, rows=6, cols=4, seats=[(1, 1)], layout="manual")
    res = _put(client, settings, db, 1, _input(name="王小二", seat=None, auto_seat=True))
    assert res.status_code == 200, res.text
    assert _seat(db, 1) == (None, None)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 3, "col": 3}, auto_seat=True),
        headers=auth(settings),
    )
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (3, 3)


def test_auto_full_class_displaced_occupant_gets_new_row_seat(client, settings, db):
    eids = _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4))
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 1, "col": 1}, auto_seat=False),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert (res.json()["seat_row"], res.json()["seat_col"]) == (1, 1)
    assert _cls(db).seat_rows == 5
    now = _seats_by_eid(db)
    assert now[eids[0]] == (5, 1)
    assert all(v is not None and v[0] is not None for v in now.values())


def _snaps(db):
    db.expire_all()
    return db.scalars(
        select(SeatArrangement)
        .where(SeatArrangement.class_id == UUID(CLASS_ID))
        .order_by(SeatArrangement.version)
    ).all()


def test_auto_seat_without_reflow_writes_one_snapshot(client, settings, db):
    _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4)[:10])
    n, v = len(_snaps(db)), _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat=None, auto_seat=True),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    snaps = _snaps(db)
    assert (len(snaps), _version(db)) == (n + 1, v + 1)
    assert snaps[-1].version == v + 1 and len(snaps[-1].layout) == 11


def test_manual_seat_create_writes_snapshot(client, settings, db):
    _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4)[:10])
    n, v = len(_snaps(db)), _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 4, "col": 4}, auto_seat=False),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    assert (len(_snaps(db)), _version(db)) == (n + 1, v + 1)


def test_reflow_plus_displaced_seat_merges_into_one_snapshot(client, settings, db):
    _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4))
    n, v = len(_snaps(db)), _version(db)
    res = client.post(
        f"{BASE}/students",
        json=_input(student_no="N1", seat={"row": 1, "col": 1}, auto_seat=False),
        headers=auth(settings),
    )
    assert res.status_code == 201, res.text
    snaps = _snaps(db)
    assert (len(snaps), _version(db)) == (n + 1, v + 1)
    assert len(snaps[-1].layout) == 17 and snaps[-1].seat_rows == 5


def test_remove_student_writes_snapshot(client, settings, db):
    _setup_grid(db, rows=4, cols=4, seats=_row_major(4, 4)[:10], layout="manual")
    n, v = len(_snaps(db)), _version(db)
    eid = enrollment_of(db, STUDENT_IDS[0])
    res = client.delete(f"{BASE}/students/{eid}", headers=auth(settings))
    assert res.status_code in (200, 204), res.text
    snaps = _snaps(db)
    assert (len(snaps), _version(db)) == (n + 1, v + 1)
    assert len(snaps[-1].layout) == 9
