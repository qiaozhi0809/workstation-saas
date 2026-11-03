from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.domain.comments.service import semester_of
from app.models import AcademicYear, Comment, Enrollment
from app.models.audit import AuditLog
from tests.factories import make_class, make_student
from tests.helpers import auth
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    COMMENT_IDS,
    SCHOOL_ID,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_USER_ID,
)

S1 = STUDENT_IDS[1]  # 李小二
URL = f"/api/v1/students/{S1}/comments"
BULK = f"/api/v1/classes/{CLASS_ID}/comments/bulk"
BODY = {"content": "  本学期进步明显  ", "generated_by_ai": True}


def _audits(db, action):
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action)).all())


def _count(db):
    return db.scalar(select(func.count()).select_from(Comment))


@pytest.mark.parametrize(
    "today,expected",
    [
        (date(2026, 11, 2), "2026-2027 第一学期"),
        (date(2026, 8, 1), "2026-2027 第一学期"),
        (date(2027, 1, 20), "2026-2027 第一学期"),
        (date(2027, 2, 1), "2026-2027 第二学期"),
        (date(2027, 3, 1), "2026-2027 第二学期"),
        (date(2027, 7, 31), "2026-2027 第二学期"),
    ],
)
def test_semester_of(today, expected):
    year = AcademicYear(name="2026-2027")
    assert semester_of(year, today) == expected


def test_list_create_delete(client, settings, db):
    h = auth(settings)
    res = client.get(URL, headers=h)
    assert res.status_code == 200
    items = res.json()["items"]
    assert [i["id"] for i in items] == COMMENT_IDS
    assert set(items[0]) == {
        "id",
        "semester",
        "content",
        "generated_by_ai",
        "current_year",
        "created_by_name",
        "can_delete",
        "created_at",
    }
    assert items[0]["semester"] == "2026-2027 第一学期"
    assert items[0]["generated_by_ai"] is False
    assert items[0]["can_delete"] is True

    res = client.post(URL, json=BODY, headers=h)
    assert res.status_code == 201
    mine = res.json()
    assert mine["content"] == "本学期进步明显"
    assert mine["generated_by_ai"] is True
    assert mine["can_delete"] is True
    assert mine["current_year"] is True
    assert mine["created_by_name"] == "张老师"
    assert mine["semester"] == "2026-2027 第一学期"

    ids = [i["id"] for i in client.get(URL, headers=h).json()["items"]]
    assert ids == [mine["id"], COMMENT_IDS[0]]

    created = _audits(db, "comment.create")
    assert [(a.success, a.object_type, a.object_id) for a in created] == [(True, "student", S1)]
    assert "进步明显" not in str(created[0].extra)

    res = client.delete(f"/api/v1/comments/{mine['id']}", headers=h)
    assert res.status_code == 204
    assert db.get(Comment, UUID(mine["id"])) is None
    d = _audits(db, "comment.delete")
    assert [(a.success, a.object_type, a.object_id) for a in d] == [(True, "comment", mine["id"])]
    assert client.get(URL, headers=h).json()["items"][0]["id"] == COMMENT_IDS[0]


def test_validation(client, settings):
    h = auth(settings)
    for patch in ({"content": "  "}, {"content": "字" * 1001}, {"generated_by_ai": "也许"}):
        res = client.post(URL, json=BODY | patch, headers=h)
        assert res.status_code == 400, patch
        assert res.json()["error"]["code"] == "BAD_REQUEST"
    assert client.post(URL, json=BODY | {"content": "字" * 1000}, headers=h).status_code == 201


def test_only_homeroom_writes(client, settings, db):
    for uid in (ASSISTANT_USER_ID, SUBJECT_USER_ID):
        h = auth(settings, uid)
        assert client.get(URL, headers=h).status_code == 403
        assert client.post(URL, json=BODY, headers=h).status_code == 403
        item = {"items": [{"student_id": S1, "content": "好"}], "generated_by_ai": False}
        assert client.post(BULK, json=item, headers=h).status_code == 403
        assert client.delete(f"/api/v1/comments/{COMMENT_IDS[0]}", headers=h).status_code == 403
    assert _count(db) == 1
    assert [a.success for a in _audits(db, "comment.read")] == [False] * 2
    assert [a.success for a in _audits(db, "comment.write")] == [False] * 6


def test_bulk_all_or_nothing(client, settings, db):
    h = auth(settings)
    other = make_class(db, "三年三班")
    stranger = make_student(db, other, "陈小三", "S9001")
    items = [
        {"student_id": STUDENT_IDS[0], "content": "  认真好学  "},
        {"student_id": str(stranger), "content": "外班"},
        {"student_id": STUDENT_IDS[2], "content": "乐于助人"},
    ]
    res = client.post(BULK, json={"items": items, "generated_by_ai": True}, headers=h)
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "AI_FIELD_INVALID"
    assert err["details"] == {"field": "items"}
    assert _count(db) == 1
    assert _audits(db, "comment.create") == []

    del items[1]
    res = client.post(BULK, json={"items": items, "generated_by_ai": True}, headers=h)
    assert res.status_code == 201
    assert res.json() == {"created": 2}
    assert _count(db) == 3
    rows = db.scalars(select(Comment).where(Comment.id != UUID(COMMENT_IDS[0]))).all()
    assert {r.content for r in rows} == {"认真好学", "乐于助人"}
    assert all(r.generated_by_ai and r.semester == "2026-2027 第一学期" for r in rows)
    assert all(r.class_id == UUID(CLASS_ID) for r in rows)
    a = _audits(db, "comment.create")
    assert len(a) == 1
    assert (a[0].success, a[0].object_type, a[0].object_id) == (True, "class", CLASS_ID)
    assert a[0].extra == {"count": 2, "generated_by_ai": True}


def test_bulk_rejects_bad_shape_and_unenrolled(client, settings, db):
    h = auth(settings)
    ok = {"student_id": STUDENT_IDS[0], "content": "好"}
    for body in (
        {"items": [], "generated_by_ai": False},
        {"items": [ok] * 81, "generated_by_ai": False},
        {"items": [{**ok, "content": " "}], "generated_by_ai": False},
        {"items": [{**ok, "content": "字" * 1001}], "generated_by_ai": False},
    ):
        res = client.post(BULK, json=body, headers=h)
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "BAD_REQUEST"
    # 学生存在但已转出本班
    enr = db.scalars(select(Enrollment).where(Enrollment.student_id == UUID(STUDENT_IDS[0]))).one()
    enr.status = "transferred"
    db.flush()
    res = client.post(BULK, json={"items": [ok], "generated_by_ai": False}, headers=h)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "AI_FIELD_INVALID"
    assert _count(db) == 1


def test_past_year_comment_read_only(client, settings, db):
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
        student_id=UUID(S1), class_id=old_class, academic_year_id=old.id, status="promoted"
    )
    db.add(old_enr)
    db.flush()
    c = Comment(
        student_id=UUID(S1),
        enrollment_id=old_enr.id,
        class_id=old_class,
        academic_year_id=old.id,
        semester="2025-2026 第二学期",
        content="学期表现稳定",
        generated_by_ai=False,
        created_by_user_id=UUID(TEACHER_USER_ID),
    )
    db.add(c)
    db.flush()

    h = auth(settings)
    items = client.get(URL, headers=h).json()["items"]
    assert len(items) == 2
    past = next(i for i in items if i["id"] == str(c.id))
    assert past["current_year"] is False
    assert past["can_delete"] is False
    assert past["semester"] == "2025-2026 第二学期"
    assert next(i for i in items if i is not past)["current_year"] is True

    res = client.delete(f"/api/v1/comments/{c.id}", headers=h)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "RECORD_READONLY"
    assert db.get(Comment, c.id) is not None


def test_any_writer_deletes_and_unknown_404(client, settings):
    h = auth(settings)
    assert (
        client.delete("/api/v1/comments/00000000-0000-0000-0000-000000000000", headers=h)
    ).status_code == 404
    # 学生不在本班:读取被拒
    url = "/api/v1/students/00000000-0000-0000-0000-000000000000/comments"
    assert client.get(url, headers=h).status_code == 404
    assert client.post(url, json=BODY, headers=h).status_code == 404


def test_other_class_student_forbidden(client, settings, db):
    other = make_class(db, "三年三班")
    sid = make_student(db, other, "陈小三", "S9001")
    url = f"/api/v1/students/{sid}/comments"
    h = auth(settings)
    assert client.get(url, headers=h).status_code == 403
    assert client.post(url, json=BODY, headers=h).status_code == 403
    res = client.post(
        f"/api/v1/classes/{other}/comments/bulk",
        json={"items": [{"student_id": str(sid), "content": "好"}], "generated_by_ai": False},
        headers=h,
    )
    assert res.status_code == 403
