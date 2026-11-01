from uuid import UUID

from sqlalchemy import select

from app.models import Attendance
from tests.factories import make_class, make_student
from tests.helpers import audit_rows, auth, enrollment_of, freeze
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_USER_ID,
)

BASE = f"/api/v1/classes/{CLASS_ID}/attendance"
NOW = "2026-11-02T02:00:00+00:00"  # 学校时区 2026-11-02(周一)10:00


def put(client, settings, day, enrollment, status, user=TEACHER_USER_ID, reason=None):
    body = {"status": status} if reason is None else {"status": status, "reason": reason}
    return client.put(f"{BASE}/{day}/{enrollment}", json=body, headers=auth(settings, user))


def day_view(client, settings, day="2026-11-02", user=TEACHER_USER_ID):
    return client.get(BASE, params={"date": day}, headers=auth(settings, user))


def test_mark_and_read(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_of(db, STUDENT_IDS[0])
    res = put(client, settings, "2026-11-02", e, "leave", reason=" 发烧 ")
    assert res.json() == {"enrollment_id": str(e), "status": "leave", "reason": "发烧"}
    body = day_view(client, settings).json()
    assert (body["date"], body["confirmed_at"]) == ("2026-11-02", None)
    assert [(i["enrollment_id"], i["status"]) for i in body["items"]] == [(str(e), "leave")]


def test_present_deletes_the_row(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_of(db, STUDENT_IDS[0])
    put(client, settings, "2026-11-02", e, "leave")
    assert put(client, settings, "2026-11-02", e, "present").json()["status"] == "present"
    assert day_view(client, settings).json()["items"] == []


def test_put_is_absolute_and_idempotent(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_of(db, STUDENT_IDS[0])
    assert put(client, settings, "2026-11-02", e, "late", user=ASSISTANT_USER_ID).status_code == 200
    assert put(client, settings, "2026-11-02", e, "late").status_code == 200
    rows = db.scalars(select(Attendance).where(Attendance.enrollment_id == e)).all()
    assert [(r.status, r.marked_by_user_id) for r in rows] == [("late", UUID(TEACHER_USER_ID))]


def test_future_date_rejected_in_school_tz(client, db, settings, monkeypatch):
    e = enrollment_of(db, STUDENT_IDS[0])
    freeze(monkeypatch, "2026-11-01T15:59:00+00:00")  # 学校时区 11-01 23:59
    res = put(client, settings, "2026-11-02", e, "late")
    assert (res.status_code, res.json()["error"]["code"]) == (400, "DATE_OUT_OF_RANGE")
    freeze(monkeypatch, "2026-11-01T16:01:00+00:00")  # 学校时区 11-02 00:01
    assert put(client, settings, "2026-11-02", e, "late").status_code == 200


def test_date_before_year_start_rejected(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    res = put(client, settings, "2026-08-31", enrollment_of(db, STUDENT_IDS[0]), "late")
    assert res.json()["error"]["code"] == "DATE_OUT_OF_RANGE"


def test_subject_teacher_reads_but_cannot_write(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    e = enrollment_of(db, STUDENT_IDS[0])
    res = put(client, settings, "2026-11-02", e, "leave", user=SUBJECT_USER_ID)
    assert res.status_code == 403
    assert [(r.action, r.success) for r in audit_rows(db, CLASS_ID)] == [
        ("attendance.write", False)
    ]
    assert day_view(client, settings, user=SUBJECT_USER_ID).status_code == 200


def test_enrollment_of_another_class_is_404(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    outsider = enrollment_of(db, make_student(db, make_class(db, "三年三班"), "外班生", "S9001"))
    assert put(client, settings, "2026-11-02", outsider, "leave").status_code == 404


def test_confirm_with_and_without_clearing(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    put(client, settings, "2026-11-02", enrollment_of(db, STUDENT_IDS[0]), "leave")
    url = f"{BASE}/2026-11-02/confirm"
    kept = client.post(url, json={"clear_exceptions": False}, headers=auth(settings)).json()
    assert len(kept["items"]) == 1 and kept["confirmed_at"] is not None
    cleared = client.post(url, json={"clear_exceptions": True}, headers=auth(settings)).json()
    assert cleared["items"] == []
    assert day_view(client, settings).json()["confirmed_at"] == cleared["confirmed_at"]


def test_month_lists_exceptions_by_date(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    put(client, settings, "2026-10-30", enrollment_of(db, STUDENT_IDS[1]), "absent")
    put(client, settings, "2026-10-29", enrollment_of(db, STUDENT_IDS[0]), "late")
    put(client, settings, "2026-11-02", enrollment_of(db, STUDENT_IDS[0]), "leave")
    body = client.get(f"{BASE}/month", params={"month": "2026-10"}, headers=auth(settings)).json()
    assert body["month"] == "2026-10"
    assert [(i["date"], i["status"]) for i in body["items"]] == [
        ("2026-10-29", "late"),
        ("2026-10-30", "absent"),
    ]
