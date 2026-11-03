from uuid import UUID

from sqlalchemy import func, select

from app.domain.seating.layout import reflow_auto
from app.models import AuditLog, Enrollment, SchoolClass, SeatArrangement
from tests.factories import make_student
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID

PREVIEW = f"/api/v1/classes/{CLASS_ID}/layout/preview"
SAVE = f"/api/v1/classes/{CLASS_ID}/layout"
SEATING = f"/api/v1/classes/{CLASS_ID}/seating"


def draft(**kw):
    base = {
        "desk_size": 2,
        "seat_layout": "manual",
        "rows": 6,
        "cols": 4,
        "podium_left": 0,
        "podium_right": 0,
        "how": "keep",
    }
    return {**base, **kw}


def post_preview(client, settings, user=None, **kw):
    headers = auth(settings, user) if user else auth(settings)
    return client.post(PREVIEW, json=draft(**kw), headers=headers)


def cls_of(db):
    db.expire_all()
    return db.get(SchoolClass, UUID(CLASS_ID))


def put_layout(client, db, settings, user=None, base=None, room="", **kw):
    body = draft(**kw)
    body["base_version"] = cls_of(db).seat_version if base is None else base
    body["room"] = room
    headers = auth(settings, user) if user else auth(settings)
    return client.put(SAVE, json=body, headers=headers)


def seats_now(db):
    db.expire_all()
    rows = db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == UUID(CLASS_ID), Enrollment.status == "active"
        )
    ).all()
    return {e.id: (e.seat_row, e.seat_col) for e in rows}


def counts(db):
    db.expire_all()
    return (
        db.scalar(select(func.count()).select_from(SeatArrangement)),
        db.scalar(select(func.count()).select_from(AuditLog)),
        sorted(seats_now(db).items(), key=lambda kv: str(kv[0])),
        cls_of(db).seat_version,
    )


def put_seats(client, db, settings, moves):
    """moves: {student index: (row, col)};其余人保持当前座位。"""
    cur = seats_now(db)
    seats = []
    for i, sid in enumerate(STUDENT_IDS):
        eid = enrollment_of(db, sid)
        seat = moves.get(i, cur[eid])
        if seat[0] is None:
            continue
        seats.append({"enrollment_id": str(eid), "row": seat[0], "col": seat[1], "locked": False})
    c = cls_of(db)
    body = {
        "base_version": c.seat_version,
        "rows": c.seat_rows,
        "cols": c.seat_cols,
        "seats": seats,
    }
    return client.put(SEATING, json=body, headers=auth(settings))


def test_preview_manual_three_per_desk(client, settings, db):
    r = post_preview(client, settings, desk_size=3, rows=4, cols=9, how="row")
    assert r.status_code == 200
    body = r.json()
    assert (body["rows"], body["cols"], body["capacity"]) == (4, 9, 36)
    assert (body["students"], body["unseated"]) == (10, 0)
    at = {s["enrollment_id"]: (s["row"], s["col"]) for s in body["seats"]}
    assert at[str(enrollment_of(db, STUDENT_IDS[0]))] == (1, 1)
    assert at[str(enrollment_of(db, STUDENT_IDS[9]))] == (2, 1)


def test_preview_auto_ignores_rows(client, settings):
    r = post_preview(client, settings, seat_layout="auto", rows=12, cols=8)
    assert (r.json()["rows"], r.json()["cols"]) == (4, 8)


def test_preview_does_not_write(client, settings, db):
    before = counts(db)
    assert post_preview(client, settings, desk_size=1, rows=5, cols=6, how="col").is_success
    assert counts(db) == before


def test_save_moves_and_bumps_version(client, settings, db):
    r = put_layout(client, db, settings, desk_size=1, rows=5, cols=6, how="row")
    assert r.status_code == 200
    assert r.json() == {"version": 1, "moved": True, "rows": 5, "cols": 6}
    c = cls_of(db)
    assert (c.desk_size, c.seat_order, c.seat_rows, c.seat_cols, c.seat_version) == (
        1,
        "row",
        5,
        6,
        1,
    )
    snap = db.scalars(select(SeatArrangement).where(SeatArrangement.version == 1)).one()
    assert (snap.desk_size, snap.seat_rows, snap.seat_cols) == (1, 5, 6)
    [row] = audit_rows(db, CLASS_ID)
    assert (row.action, row.success, row.extra["moved"], row.extra["how"]) == (
        "class.layout",
        True,
        True,
        "row",
    )


def test_save_room_only_keeps_version(client, settings, db):
    before = seats_now(db)
    r = put_layout(client, db, settings, room="博学楼 301")
    assert r.json() == {"version": 0, "moved": False, "rows": 6, "cols": 4}
    c = cls_of(db)
    assert (c.room, c.seat_version) == ("博学楼 301", 0)
    assert seats_now(db) == before
    assert db.scalar(select(func.count()).select_from(SeatArrangement)) == 0
    [row] = audit_rows(db, CLASS_ID)
    assert row.extra["moved"] is False


def test_layout_save_stale_version_conflict(client, settings, db):
    assert put_layout(client, db, settings, rows=5).status_code == 200
    before = counts(db)
    r = put_layout(client, db, settings, base=0, rows=3, room="x")
    assert r.status_code == 409
    err = r.json()["error"]
    assert (err["code"], err["details"]) == ("SEAT_VERSION_CONFLICT", {"current_version": 1})
    assert counts(db) == before
    assert cls_of(db).room != "x"


def test_save_removing_podium_moves_student(client, settings, db):
    assert put_layout(client, db, settings, podium_left=1).status_code == 200
    assert put_seats(client, db, settings, {0: (0, -1)}).status_code == 200
    wang = enrollment_of(db, STUDENT_IDS[0])
    assert seats_now(db)[wang] == (0, -1)
    r = put_layout(client, db, settings, podium_left=0)
    assert r.json()["moved"] is True
    now = seats_now(db)
    assert now[wang][0] >= 1
    assert all(s[0] is not None for s in now.values())
    assert len(set(now.values())) == 10


def test_capacity_short_leaves_unseated(client, settings, db):
    r = post_preview(client, settings, rows=2, cols=2)
    assert (r.json()["unseated"], r.json()["capacity"]) == (6, 4)
    assert put_layout(client, db, settings, rows=2, cols=2).status_code == 200
    now = list(seats_now(db).values())
    assert sum(1 for s in now if s[0] is not None) == 4
    assert sum(1 for s in now if s[0] is None) == 6


def test_switch_to_auto_from_manual(client, settings, db):
    assert put_seats(client, db, settings, {0: (6, 1)}).status_code == 200
    r = put_layout(client, db, settings, seat_layout="auto", cols=4)
    assert r.json() == {"version": 2, "moved": True, "rows": 4, "cols": 4}
    now = seats_now(db)
    assert now[enrollment_of(db, STUDENT_IDS[0])][0] <= 4
    assert len(set(now.values())) == 10
    assert cls_of(db).seat_layout == "auto"


def test_manual_cols_must_match_desk(client, settings, db):
    assert post_preview(client, settings, desk_size=3, cols=4).status_code == 400
    assert post_preview(client, settings, podium_left=3).status_code == 400
    assert post_preview(client, settings, desk_size=4).status_code == 400
    assert post_preview(client, settings, rows=13).status_code == 400
    assert put_layout(client, db, settings, room="长" * 31).status_code == 400
    assert put_layout(client, db, settings, room="  博学楼  ").status_code == 200
    assert cls_of(db).room == "博学楼"


def test_teachers_without_write_denied_and_audited(client, settings, db):
    for user in (ASSISTANT_USER_ID, SUBJECT_USER_ID):
        assert post_preview(client, settings, user=user).status_code == 403
        assert put_layout(client, db, settings, user=user).status_code == 403
    rows = audit_rows(db, CLASS_ID)
    assert len(rows) == 4
    assert {(r.action, r.success) for r in rows} == {("seating.write", False)}


def test_reflow_auto_shrinks_and_moves_last_row(db):
    c = cls_of(db)
    c.seat_layout = "auto"
    last = enrollment_of(db, STUDENT_IDS[0])
    e = db.get(Enrollment, last)
    e.seat_row, e.seat_col, e.seat_locked = 6, 1, True
    db.flush()
    assert reflow_auto(db, c, None) is True
    db.commit()
    c = cls_of(db)
    assert (c.seat_rows, c.seat_cols, c.seat_version) == (4, 4, 1)
    now = seats_now(db)
    assert all(s[0] is not None and s[0] <= 4 for s in now.values())
    assert len(set(now.values())) == 10
    assert db.get(Enrollment, last, populate_existing=True).seat_locked is False
    assert db.scalars(select(SeatArrangement)).one().seat_rows == 4


def test_reflow_auto_noop_when_manual_or_same(db):
    c = cls_of(db)
    assert reflow_auto(db, c, None) is False  # seed 班是 manual
    c.seat_layout = "auto"
    c.seat_rows = 4
    db.flush()
    before = seats_now(db)
    assert reflow_auto(db, c, None) is False
    assert (cls_of(db).seat_version, seats_now(db)) == (0, before)


def test_reflow_auto_grows_for_many_students(db):
    c = cls_of(db)
    c.seat_layout = "auto"
    for i in range(30):
        make_student(db, c.id, f"新生{i:02d}", f"N{i:03d}", student_no=f"2027{i:03d}")
    db.flush()
    assert reflow_auto(db, c, None) is True
    c = cls_of(db)
    assert (c.seat_rows, c.seat_cols) == (10, 4)
    seated = [s for s in seats_now(db).values() if s[0] is not None]
    assert len(seated) == 10  # 新同学原本没座位,keep 且 fill_all=False 时仍保持未排座
