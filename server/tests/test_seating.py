from uuid import UUID

from sqlalchemy import select, update

from app.models import Enrollment, SchoolClass, SeatArrangement
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID, STUDENT_IDS

URL = f"/api/v1/classes/{CLASS_ID}/seating"


def payload(db, base=0, rows=6, cols=4, moves=None, drop=()):
    seats = []
    for i, sid in enumerate(STUDENT_IDS):
        if i in drop:
            continue
        row, col = (moves or {}).get(i, (i // 4 + 1, i % 4 + 1))
        seats.append(
            {"enrollment_id": str(enrollment_of(db, sid)), "row": row, "col": col, "locked": False}
        )
    return {"base_version": base, "rows": rows, "cols": cols, "seats": seats}


def layout_now(db):
    db.expire_all()
    rows = db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == UUID(CLASS_ID), Enrollment.status == "active"
        )
    ).all()
    return {e.id: (e.seat_row, e.seat_col, e.seat_locked) for e in rows}


def version_now(db):
    db.expire_all()
    return db.get(SchoolClass, UUID(CLASS_ID)).seat_version


def test_save_swaps_unseats_and_bumps_version(client, db, settings):
    body = payload(db, moves={0: (1, 2), 1: (1, 1)}, drop={2})
    assert client.put(URL, json=body, headers=auth(settings)).json() == {
        "version": 1,
        "rows": 6,
        "cols": 4,
    }
    now = layout_now(db)
    assert now[enrollment_of(db, STUDENT_IDS[0])] == (1, 2, False)
    assert now[enrollment_of(db, STUDENT_IDS[1])] == (1, 1, False)
    assert now[enrollment_of(db, STUDENT_IDS[2])] == (None, None, False)
    snap = db.scalars(
        select(SeatArrangement).where(SeatArrangement.class_id == UUID(CLASS_ID))
    ).one()
    assert (snap.version, len(snap.layout)) == (1, 9)


def test_stale_base_version_conflict_writes_nothing(client, db, settings):
    first = payload(db, moves={0: (1, 2), 1: (1, 1)})
    assert client.put(URL, json=first, headers=auth(settings)).status_code == 200
    before = layout_now(db)
    res = client.put(URL, json=payload(db, base=0, moves={3: (6, 4)}), headers=auth(settings))
    assert res.status_code == 409
    err = res.json()["error"]
    assert (err["code"], err["details"]) == ("SEAT_VERSION_CONFLICT", {"current_version": 1})
    assert layout_now(db) == before
    assert version_now(db) == 1


def test_resize_updates_class_dimensions(client, db, settings):
    assert client.put(URL, json=payload(db, rows=3, cols=4), headers=auth(settings)).is_success
    [cls] = client.get("/api/v1/me/classes", headers=auth(settings)).json()["items"]
    assert (cls["seat_rows"], cls["seat_cols"]) == (3, 4)


def test_invalid_layouts(client, db, settings):
    duplicate_enrollment = payload(db)
    duplicate_enrollment["seats"].append({**duplicate_enrollment["seats"][0], "row": 6, "col": 4})
    cases = {
        "out_of_grid": payload(db, rows=2),
        "duplicate_position": payload(db, moves={1: (1, 1)}),
        "duplicate_enrollment": duplicate_enrollment,
    }
    for reason, body in cases.items():
        res = client.put(URL, json=body, headers=auth(settings))
        err = res.json()["error"]
        assert (res.status_code, err["code"], err["details"]["reason"]) == (
            400,
            "SEAT_INVALID",
            reason,
        )
    assert version_now(db) == 0


def test_inactive_enrollment_in_layout_is_400(client, db, settings):
    body = payload(db)
    gone = enrollment_of(db, STUDENT_IDS[9])
    db.execute(update(Enrollment).where(Enrollment.id == gone).values(status="transferred"))
    res = client.put(URL, json=body, headers=auth(settings))
    assert res.json()["error"]["details"]["reason"] == "unknown_enrollment"
    assert version_now(db) == 0


def test_lock_roundtrip(client, db, settings):
    body = payload(db)
    body["seats"][0]["locked"] = True
    client.put(URL, json=body, headers=auth(settings))
    items = client.get(f"/api/v1/classes/{CLASS_ID}/students", headers=auth(settings)).json()
    wang = next(i for i in items["items"] if i["name"] == "王小一")
    assert wang["seat_locked"] is True


def test_assistant_cannot_save_and_is_audited(client, db, settings):
    res = client.put(URL, json=payload(db), headers=auth(settings, ASSISTANT_USER_ID))
    assert res.status_code == 403
    assert [(r.action, r.success) for r in audit_rows(db, CLASS_ID)] == [("seating.write", False)]
