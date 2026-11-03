from uuid import UUID

from sqlalchemy import select, text

from app.models import Enrollment, SchoolClass, Student
from app.rbac.roles import Role
from tests.factories import bind, make_user
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID

BASE = f"/api/v1/classes/{CLASS_ID}"
IMPORT = f"{BASE}/students/import"
EXPORT = f"{BASE}/students/export"


def _row(name, student_no=None, **over):
    body = {
        "name": name,
        "gender": None,
        "student_no": student_no,
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
    }
    body.update(over)
    return body


def _version(db):
    db.expire_all()
    return db.get(SchoolClass, UUID(CLASS_ID)).seat_version


def _by_name(db, name):
    db.expire_all()
    student = db.scalars(select(Student).where(Student.name == name)).one()
    enrollment = db.scalars(
        select(Enrollment).where(Enrollment.student_id == student.id, Enrollment.status == "active")
    ).one()
    return student, enrollment


def test_import_creates_and_auto_seats(client, settings, db):
    before = _version(db)
    body = {
        "rows": [_row("孙一", "2026101", class_role="学习委员"), _row("孙二")],
        "auto_seat": True,
    }
    r = client.post(IMPORT, json=body, headers=auth(settings))
    assert r.status_code == 201
    assert r.json() == {"created": 2, "skipped": []}
    s1, e1 = _by_name(db, "孙一")
    _, e2 = _by_name(db, "孙二")
    assert (e1.seat_row, e1.seat_col) == (3, 3)
    assert (e2.seat_row, e2.seat_col) == (3, 4)
    assert e1.class_role == "学习委员"
    assert s1.mk.startswith("S")
    assert _version(db) == before + 1
    rows = audit_rows(db, CLASS_ID)
    imp = [a for a in rows if a.action == "student.import"]
    assert len(imp) == 1 and imp[0].extra == {"created": 2, "skipped": 0}


def test_import_without_auto_seat_leaves_unseated(client, settings, db):
    before = _version(db)
    r = client.post(
        IMPORT, json={"rows": [_row("周一")], "auto_seat": False}, headers=auth(settings)
    )
    assert r.status_code == 201
    _, e = _by_name(db, "周一")
    assert e.seat_row is None
    assert _version(db) == before


def test_import_skips_duplicates_and_taken_numbers(client, settings, db):
    rows = [
        _row("王小一", "2026001"),
        _row("王小一"),
        _row("新名字", "2026002"),
        _row("孙三", "2026102"),
        _row("孙三", "2026102"),
    ]
    r = client.post(IMPORT, json={"rows": rows, "auto_seat": False}, headers=auth(settings))
    assert r.status_code == 201
    assert r.json() == {
        "created": 1,
        "skipped": [
            {"index": 0, "reason": "duplicate"},
            {"index": 1, "reason": "duplicate"},
            {"index": 2, "reason": "student_no_taken"},
            {"index": 4, "reason": "duplicate"},
        ],
    }
    db.expire_all()
    assert db.get(Student, UUID(STUDENT_IDS[1])).name == "李小二"
    assert db.get(Student, UUID(STUDENT_IDS[1])).student_no == "2026002"
    imp = [a for a in audit_rows(db, CLASS_ID) if a.action == "student.import"]
    assert imp[0].extra == {"created": 1, "skipped": 4}


def test_import_limits(client, settings):
    h = auth(settings)
    assert client.post(IMPORT, json={"rows": [], "auto_seat": False}, headers=h).status_code == 400
    rows = [_row(f"学生{i}") for i in range(201)]
    r = client.post(IMPORT, json={"rows": rows, "auto_seat": False}, headers=h)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "BAD_REQUEST"


def test_import_forbidden_for_subject_teacher(client, settings, db):
    r = client.post(
        IMPORT,
        json={"rows": [_row("孙四")], "auto_seat": False},
        headers=auth(settings, SUBJECT_USER_ID),
    )
    assert r.status_code == 403


def test_export_records_audited_and_forbidden_for_subject_teacher(client, settings, db):
    r = client.get(EXPORT, headers=auth(settings))
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 10
    assert items[0]["name"] == "王小一"
    acts = [a for a in audit_rows(db, CLASS_ID) if a.action == "student.export"]
    assert len(acts) == 1 and acts[0].success is True and acts[0].object_type == "class"
    r = client.get(EXPORT, headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 403


def _notes_url(sid):
    return f"/api/v1/students/{sid}/my-notes"


def test_my_notes_roundtrip_and_privacy(client, settings, db):
    sid = STUDENT_IDS[0]
    h = auth(settings)
    r = client.put(_notes_url(sid), json={"text": " 家访记录 "}, headers=h)
    assert r.status_code == 200
    assert r.json()["text"] == "家访记录"
    assert r.json()["updated_at"]
    prof = client.get(f"/api/v1/students/{sid}", headers=h).json()
    assert prof["teacher_notes"]["text"] == "家访记录"

    other = make_user(db, "homeroom2")
    bind(db, other.id, Role.homeroom_teacher, class_id=UUID(CLASS_ID))
    db.commit()
    oh = auth(settings, other.id)
    assert "teacher_notes" not in client.get(f"/api/v1/students/{sid}", headers=oh).json()
    assert client.put(_notes_url(sid), json={"text": "另一条"}, headers=oh).status_code == 200
    assert client.get(f"/api/v1/students/{sid}", headers=h).json()["teacher_notes"]["text"] == (
        "家访记录"
    )

    r = client.put(_notes_url(sid), json={"text": "  "}, headers=h)
    assert r.status_code == 200 and r.json()["text"] == ""
    assert "teacher_notes" not in client.get(f"/api/v1/students/{sid}", headers=h).json()
    assert client.get(f"/api/v1/students/{sid}", headers=oh).json()["teacher_notes"]["text"] == (
        "另一条"
    )
    assert any(a.action == "student.write_notes" for a in audit_rows(db, sid))

    r = client.put(_notes_url(sid), json={"text": "x"}, headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 403
    assert any(a.action == "student.teacher_notes" for a in audit_rows(db, sid))
    r = client.put(_notes_url(sid), json={"text": "字" * 2001}, headers=h)
    assert r.status_code == 400
    r = client.put(
        _notes_url("a0000099-0000-0000-0000-000000000099"), json={"text": "x"}, headers=h
    )
    assert r.status_code == 404


def _empty_auto_class(db, *, rows, cols, desk=2):
    """种子班改成 auto、没有在读同学。"""
    db.expire_all()
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    cls.seat_layout, cls.seat_rows, cls.seat_cols, cls.desk_size = "auto", rows, cols, desk
    db.execute(
        text(
            "UPDATE enrollments SET status = 'removed', seat_row = NULL, seat_col = NULL "
            "WHERE class_id = :c"
        ),
        {"c": CLASS_ID},
    )
    db.commit()


def _imported_seats(db, n):
    db.expire_all()
    out = []
    for i in range(n):
        _, e = _by_name(db, f"学生{i:03d}")
        out.append((e.seat_row, e.seat_col))
    return out


def test_import_into_auto_class_grows_then_seats(client, settings, db):
    _empty_auto_class(db, rows=4, cols=8)
    rows = [_row(f"学生{i:03d}", f"2028{i:03d}") for i in range(40)]
    r = client.post(IMPORT, json={"rows": rows, "auto_seat": True}, headers=auth(settings))
    assert r.status_code == 201, r.text
    assert r.json() == {"created": 40, "skipped": []}
    db.expire_all()
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    assert (cls.seat_rows, cls.seat_cols) == (5, 8)
    # 按横排依次落座,顺序与导入顺序一致
    assert _imported_seats(db, 40) == [(i // 8 + 1, i % 8 + 1) for i in range(40)]


def test_import_beyond_capacity_leaves_rest_unseated(client, settings, db):
    _empty_auto_class(db, rows=4, cols=8)
    n = 130
    rows = [_row(f"学生{i:03d}", f"2028{i:03d}") for i in range(n)]
    r = client.post(IMPORT, json={"rows": rows, "auto_seat": True}, headers=auth(settings))
    assert r.status_code == 201, r.text
    assert r.json() == {"created": n, "skipped": []}
    db.expire_all()
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    assert (cls.seat_rows, cls.seat_cols) == (10, 12)
    seats = _imported_seats(db, n)
    seated = [s for s in seats if s[0] is not None]
    assert len(seated) == 120 and len(set(seated)) == 120
    assert all(1 <= r_ <= 10 and 1 <= c_ <= 12 for r_, c_ in seated)
    assert seats[:120] == [(i // 12 + 1, i % 12 + 1) for i in range(120)]
    assert seats[120:] == [(None, None)] * 10  # 多出来的 10 人未排座


def test_import_into_auto_class_without_auto_seat_still_grows(client, settings, db):
    _empty_auto_class(db, rows=4, cols=8)
    rows = [_row(f"学生{i:03d}", f"2028{i:03d}") for i in range(40)]
    r = client.post(IMPORT, json={"rows": rows, "auto_seat": False}, headers=auth(settings))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert db.get(SchoolClass, UUID(CLASS_ID)).seat_rows == 5
    assert all(s == (None, None) for s in _imported_seats(db, 40))


def test_import_auto_seat_writes_one_snapshot(client, settings, db):
    from app.models import SeatArrangement

    def snaps():
        db.expire_all()
        return db.scalars(
            select(SeatArrangement).where(SeatArrangement.class_id == UUID(CLASS_ID))
        ).all()

    n, v = len(snaps()), _version(db)
    rows = [_row("新甲", "Z1"), _row("新乙", "Z2")]
    res = client.post(IMPORT, json={"rows": rows, "auto_seat": True}, headers=auth(settings))
    assert res.status_code == 201, res.text
    assert (len(snaps()), _version(db)) == (n + 1, v + 1)
