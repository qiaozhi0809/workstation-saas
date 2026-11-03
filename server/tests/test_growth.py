from datetime import date
from uuid import UUID

from sqlalchemy import select

from app.models import AcademicYear, Enrollment, GrowthRecord
from app.models.audit import AuditLog
from tests.factories import make_class, make_student
from tests.helpers import auth
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    SCHOOL_ID,
    STUDENT_IDS,
    SUBJECT_USER_ID,
)

S0 = STUDENT_IDS[0]
URL = f"/api/v1/students/{S0}/growth-records"
BODY = {"type": "表扬", "date": "2026-11-01", "content": "  主动整理图书角  "}


def _audits(db, action):
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action)).all())


def test_list_seed_records_newest_first(client, settings):
    res = client.get(URL, headers=auth(settings))
    assert res.status_code == 200
    items = res.json()["items"]
    assert [i["type"] for i in items] == ["谈话", "表扬"]
    assert (
        items[0]
        | {
            "academic_year_name": "2026-2027",
            "class_name": "三年二班",
            "current_year": True,
            "created_by_name": "张老师",
            "can_delete": True,
        }
        == items[0]
    )
    assert set(items[0]) == {
        "id",
        "type",
        "date",
        "content",
        "academic_year_name",
        "class_name",
        "current_year",
        "created_by_name",
        "can_delete",
        "created_at",
    }


def test_create_by_assistant_and_delete_rules(client, settings, db):
    h2 = auth(settings, ASSISTANT_USER_ID)
    res = client.post(URL, json=BODY, headers=h2)
    assert res.status_code == 201
    mine = res.json()
    assert mine["content"] == "主动整理图书角"
    assert mine["can_delete"] is True
    assert mine["current_year"] is True
    assert mine["created_by_name"] == "王老师"
    assert client.delete(f"/api/v1/growth-records/{mine['id']}", headers=h2).status_code == 204

    res = client.post(URL, json=BODY, headers=h2)
    theirs_by_t2 = res.json()["id"]
    # 班主任可删副班主任写的
    assert (
        client.delete(f"/api/v1/growth-records/{theirs_by_t2}", headers=auth(settings)).status_code
        == 204
    )

    # 副班主任不能删班主任写的
    seed_id = client.get(URL, headers=h2).json()["items"][0]["id"]
    listed = client.get(URL, headers=h2).json()["items"]
    assert all(i["can_delete"] is False for i in listed)
    res = client.delete(f"/api/v1/growth-records/{seed_id}", headers=h2)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"
    rows = [a for a in _audits(db, "growth.delete") if a.object_id == seed_id]
    assert [(a.success, a.object_type) for a in rows] == [(False, "growth_record")]
    assert db.get(GrowthRecord, UUID(seed_id)) is not None
    ok = [a for a in _audits(db, "growth.delete") if a.success]
    assert len(ok) == 2 and all(a.object_type == "growth_record" for a in ok)


def test_subject_teacher_reads_only(client, settings, db):
    h3 = auth(settings, SUBJECT_USER_ID)
    res = client.get(URL, headers=h3)
    assert res.status_code == 200
    assert all(i["can_delete"] is False for i in res.json()["items"])
    res = client.post(URL, json=BODY, headers=h3)
    assert res.status_code == 403
    rows = _audits(db, "growth.write")
    assert [(a.success, a.object_id) for a in rows] == [(False, S0)]


def test_validation(client, settings):
    h = auth(settings)
    for patch in (
        {"type": "批评"},
        {"content": "  "},
        {"content": "字" * 501},
        {"date": "不是日期"},
    ):
        res = client.post(URL, json=BODY | patch, headers=h)
        assert res.status_code == 400, patch
        assert res.json()["error"]["code"] == "BAD_REQUEST"
    assert client.post(URL, json=BODY | {"content": "字" * 500}, headers=h).status_code == 201


def test_past_year_record_is_read_only(client, settings, db):
    old = AcademicYear(
        school_id=UUID(SCHOOL_ID),
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 7, 15),
        is_active=False,
    )
    db.add(old)
    db.flush()
    old_class = make_class(db, "二年一班", year_id=old.id)
    old_enr = Enrollment(
        student_id=UUID(S0), class_id=old_class, academic_year_id=old.id, status="promoted"
    )
    db.add(old_enr)
    db.flush()
    rec = GrowthRecord(
        student_id=UUID(S0),
        enrollment_id=old_enr.id,
        class_id=old_class,
        academic_year_id=old.id,
        type="获奖",
        date=date(2026, 5, 20),
        content="获得校运会跳远第一名",
        created_by_user_id=UUID(ASSISTANT_USER_ID),
    )
    db.add(rec)
    db.flush()

    h = auth(settings)
    items = client.get(URL, headers=h).json()["items"]
    assert len(items) == 3
    past = next(i for i in items if i["id"] == str(rec.id))
    assert past["current_year"] is False
    assert past["can_delete"] is False
    assert past["academic_year_name"] == "2025-2026"
    assert past["class_name"] == "二年一班"
    assert all(i["current_year"] for i in items if i is not past)

    res = client.delete(f"/api/v1/growth-records/{rec.id}", headers=h)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "RECORD_READONLY"
    assert db.get(GrowthRecord, rec.id) is not None


def test_other_class_student_forbidden(client, settings, db):
    other = make_class(db, "三年三班")
    sid = make_student(db, other, "陈小三", "S9001")
    url = f"/api/v1/students/{sid}/growth-records"
    h = auth(settings)
    assert client.get(url, headers=h).status_code == 403
    assert client.post(url, json=BODY, headers=h).status_code == 403
    assert [a.success for a in _audits(db, "growth.read")] == [False]


def test_unknown_student_404(client, settings):
    url = "/api/v1/students/00000000-0000-0000-0000-000000000000/growth-records"
    assert client.get(url, headers=auth(settings)).status_code == 404
    assert client.post(url, json=BODY, headers=auth(settings)).status_code == 404


def test_delete_unknown_record_404(client, settings):
    url = "/api/v1/growth-records/00000000-0000-0000-0000-000000000000"
    res = client.delete(url, headers=auth(settings))
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_growth_audit_without_content(client, settings, db):
    res = client.post(URL, json=BODY, headers=auth(settings))
    rid = res.json()["id"]
    created = _audits(db, "growth.create")
    assert len(created) == 1
    a = created[0]
    assert (a.success, a.object_type, a.object_id) == (True, "student", S0)
    assert "主动整理" not in str(a.extra)
    client.delete(f"/api/v1/growth-records/{rid}", headers=auth(settings))
    d = _audits(db, "growth.delete")
    assert [(x.success, x.object_type, x.object_id) for x in d] == [(True, "growth_record", rid)]
    assert "主动整理" not in str(d[0].extra)
