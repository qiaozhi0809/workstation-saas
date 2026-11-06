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
    YEAR_ID,
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


def test_semester_uses_term2_start():
    year = AcademicYear(name="2026-2027", term2_start=date(2027, 2, 20))
    assert semester_of(year, date(2027, 2, 19)) == "2026-2027 第一学期"
    assert semester_of(year, date(2027, 2, 20)) == "2026-2027 第二学期"
    assert semester_of(year, date(2026, 11, 2)) == "2026-2027 第一学期"


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
        "parent_visible",
        "can_share",
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


def _past_comment(db, *, visible: bool = True) -> Comment:
    """李小二去年在二年一班的评语:那个班属于往年学年,当前学年没有任何人对它有 comment.write。"""
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
        parent_visible=visible,
        created_by_user_id=UUID(TEACHER_USER_ID),
    )
    db.add(c)
    db.flush()
    return c


def test_past_year_comment_read_only(client, settings, db):
    c = _past_comment(db)
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


def test_current_homeroom_can_share_past_comment(client, settings, db):
    """往年的班已没人有 comment.write:"给家长看"改由学生现在的班主任切(L69),
    列表里 can_share 为真而 can_delete 仍为假(L70)。"""
    c = _past_comment(db, visible=False)
    put = f"/api/v1/comments/{c.id}/parent-visible"
    h = auth(settings)
    items = {i["id"]: i for i in client.get(URL, headers=h).json()["items"]}
    assert items[str(c.id)]["can_share"] is True and items[str(c.id)]["can_delete"] is False
    assert items[COMMENT_IDS[0]]["can_share"] is True
    res = client.put(put, json={"visible": True}, headers=h)
    assert res.status_code == 200
    assert res.json()["parent_visible"] is True and res.json()["can_share"] is True
    assert db.get(Comment, c.id).parent_visible is True
    assert [a.object_id for a in _audits(db, "comment.share")] == [str(c.id)]
    # 往年评语仍然只读:能切"给家长看",不能删
    assert client.delete(f"/api/v1/comments/{c.id}", headers=h).status_code == 409


def test_others_cannot_share(client, settings, db):
    """不是学生现在班的班主任都不能切:年级组长能看(can_share 为假)但 PUT 403;任课老师 403;
    学生年内转班后,评语所在班(老班)的班主任也不能切,新班班主任能切;学生没有在读班时谁也不能切。"""
    from app.rbac.roles import Role
    from tests.factories import bind, make_user
    from tests.seed_ids import GRADE_ID

    c = _past_comment(db, visible=False)
    put = f"/api/v1/comments/{c.id}/parent-visible"
    head = make_user(db, "gradehead_x", "组长")
    bind(db, head.id, Role.grade_head, grade_id=GRADE_ID)
    hh = auth(settings, head.id)
    items = client.get(URL, headers=hh).json()["items"]
    assert len(items) == 2 and all(i["can_share"] is False for i in items)
    assert client.put(put, json={"visible": True}, headers=hh).status_code == 403
    assert (
        client.put(put, json={"visible": True}, headers=auth(settings, SUBJECT_USER_ID)).status_code
        == 403
    )

    class_b = make_class(db, "三年四班")
    new_homeroom = make_user(db, "teacher_b", "乙老师")
    bind(db, new_homeroom.id, Role.homeroom_teacher, class_id=class_b)
    old_enr = db.scalars(
        select(Enrollment).where(Enrollment.student_id == UUID(S1), Enrollment.status == "active")
    ).one()
    old_enr.status = "transferred"
    new_enr = Enrollment(
        student_id=UUID(S1), class_id=class_b, academic_year_id=old_enr.academic_year_id
    )
    db.add(new_enr)
    db.flush()
    # 老班班主任对评语所在班有 comment.write,但学生已不在他班:不能切
    assert client.put(put, json={"visible": True}, headers=auth(settings)).status_code == 403
    hb = auth(settings, new_homeroom.id)
    listed = {i["id"]: i for i in client.get(URL, headers=hb).json()["items"]}
    assert listed[COMMENT_IDS[0]]["can_share"] is True
    assert listed[COMMENT_IDS[0]]["can_delete"] is False
    res = client.put(
        f"/api/v1/comments/{COMMENT_IDS[0]}/parent-visible", json={"visible": False}, headers=hb
    )
    assert res.status_code == 200 and res.json()["parent_visible"] is False

    new_enr.status = "removed"
    db.flush()
    assert client.put(put, json={"visible": True}, headers=hb).status_code == 403
    assert db.get(Comment, c.id).parent_visible is False
    denied = [a for a in _audits(db, "comment.write") if not a.success]
    assert [(a.object_type, a.object_id) for a in denied] == [("comment", str(c.id))] * 4


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


def test_can_delete_follows_the_comments_own_class(client, settings, db):
    """学生年内转班:新班班主任看到老班写的评语,按钮与 DELETE 都以评语所在班为准。"""
    from app.models import Enrollment as Enr
    from app.rbac.roles import Role
    from tests.factories import bind, make_user

    class_b = make_class(db, "三年四班")
    new_homeroom = make_user(db, "teacher_b", "乙老师")
    bind(db, new_homeroom.id, Role.homeroom_teacher, class_id=class_b)
    old_enr = db.scalars(
        select(Enr).where(Enr.student_id == UUID(S1), Enr.status == "active")
    ).one()
    old_enr.status = "transferred"
    db.add(Enr(student_id=UUID(S1), class_id=class_b, academic_year_id=old_enr.academic_year_id))
    db.flush()

    hb = auth(settings, new_homeroom.id)
    items = client.get(URL, headers=hb).json()["items"]
    assert [i["id"] for i in items] == COMMENT_IDS
    assert items[0]["can_delete"] is False
    assert client.delete(f"/api/v1/comments/{COMMENT_IDS[0]}", headers=hb).status_code == 403
    assert db.get(Comment, UUID(COMMENT_IDS[0])) is not None

    # 老班班主任:列表不可见(学生已不在其班),但 DELETE 仍按评语所在班放行
    assert (
        client.delete(f"/api/v1/comments/{COMMENT_IDS[0]}", headers=auth(settings)).status_code
        == 204
    )


def _bulk(client, settings, items, ai=True):
    body = {"items": [{"student_id": s, "content": c} for s, c in items], "generated_by_ai": ai}
    return client.post(BULK, json=body, headers=auth(settings))


def test_bulk_resend_skips_existing_comments(client, settings, db):
    items = [(STUDENT_IDS[0], "认真好学"), (STUDENT_IDS[1], "乐于助人")]
    assert _bulk(client, settings, items).json() == {"created": 2}
    res = _bulk(client, settings, items)
    assert res.status_code == 201
    assert res.json() == {"created": 0}
    assert _count(db) == 3
    counts = [a.extra["count"] for a in _audits(db, "comment.create")]
    assert counts == [2, 0]


def test_bulk_duplicates_inside_one_batch_save_once(client, settings, db):
    items = [
        (STUDENT_IDS[0], "认真好学"),
        (STUDENT_IDS[0], "认真好学"),
        (STUDENT_IDS[1], "认真好学"),
    ]
    assert _bulk(client, settings, items).json() == {"created": 2}
    assert _count(db) == 3


def test_bulk_changed_content_is_new_and_other_semester_is_not_a_duplicate(client, settings, db):
    assert _bulk(client, settings, [(STUDENT_IDS[0], "认真好学")]).json() == {"created": 1}
    assert _bulk(client, settings, [(STUDENT_IDS[0], "认真好学!")]).json() == {"created": 1}
    # 同一学生、同内容、不同学期:把已存的那条挪到另一个学期,再发同样的内容就是新评语
    row = db.scalars(select(Comment).where(Comment.content == "认真好学")).one()
    row.semester = "2025-2026 第二学期"
    db.flush()
    assert _bulk(client, settings, [(STUDENT_IDS[0], "认真好学")]).json() == {"created": 1}
    assert _count(db) == 4


def test_single_create_duplicate_returns_existing(client, settings, db):
    h = auth(settings)
    first = client.post(URL, json=BODY, headers=h)
    assert first.status_code == 201
    again = client.post(URL, json=BODY, headers=h)
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert _count(db) == 2


def test_bulk_concurrent_duplicates_store_once(engine):
    import threading
    import time
    from types import SimpleNamespace

    from sqlalchemy.orm import Session

    from app.domain.comments.service import create_bulk
    from app.models import User

    content = "并发测试评语"
    item = SimpleNamespace(student_id=UUID(STUDENT_IDS[0]), content=content)
    results: list[int] = []
    errors: list[BaseException] = []

    def run(hold: threading.Event | None, started: threading.Event | None) -> None:
        try:
            _run(hold, started)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    def _run(hold: threading.Event | None, started: threading.Event | None) -> None:
        with Session(engine) as s:
            year = s.get(AcademicYear, UUID(YEAR_ID))
            user = s.get(User, UUID(TEACHER_USER_ID))
            n = create_bulk(s, UUID(CLASS_ID), year, user, [item], False, date(2026, 11, 2))
            if started:
                started.set()
            if hold:
                hold.wait(5)
            s.commit()
            results.append(n)

    hold, started = threading.Event(), threading.Event()
    t1 = threading.Thread(target=run, args=(hold, started))
    t1.start()
    assert started.wait(5)
    t2 = threading.Thread(target=run, args=(None, None))
    t2.start()
    time.sleep(0.5)  # 第二个会话此时卡在唯一索引上,等第一个提交
    hold.set()
    t1.join(10)
    t2.join(10)
    try:
        if errors:
            raise errors[0]
        assert not t1.is_alive()
        assert not t2.is_alive()
        assert sorted(results) == [0, 1]
        with Session(engine) as s:
            stored = s.scalar(
                select(func.count()).select_from(Comment).where(Comment.content == content)
            )
        assert stored == 1
    finally:
        with Session(engine) as s:
            s.query(Comment).filter(Comment.content == content).delete()
            s.commit()


def test_duplicate_returns_original_author(client, settings, db):
    from app.rbac.roles import Role
    from tests.factories import bind, make_user

    first = make_user(db, "teacher_first", "甲老师")
    bind(db, first.id, Role.homeroom_teacher, class_id=CLASS_ID)
    res1 = client.post(URL, json=BODY, headers=auth(settings, first.id))
    assert res1.status_code == 201
    res2 = client.post(URL, json=BODY, headers=auth(settings))
    assert res2.status_code == 200
    assert res2.json()["id"] == res1.json()["id"]
    assert res2.json()["created_by_name"] == "甲老师"


def _set_ai_review(db, on: bool):
    from app.domain.school_settings.service import get_switches, save_switches

    sw = get_switches(db, UUID(SCHOOL_ID))
    save_switches(
        db,
        UUID(SCHOOL_ID),
        UUID(TEACHER_USER_ID),
        sw.model_copy(update={"ai_review_before_send": on}),
    )


def test_ai_comment_hidden_until_shared(client, settings, db):
    h = auth(settings)
    _set_ai_review(db, True)
    ai = client.post(URL, json=BODY, headers=h).json()
    hand = client.post(
        URL, json={"content": "手写评语", "generated_by_ai": False}, headers=h
    ).json()
    assert ai["parent_visible"] is False and hand["parent_visible"] is True
    listed = {i["id"]: i for i in client.get(URL, headers=h).json()["items"]}
    assert listed[ai["id"]]["parent_visible"] is False

    put = f"/api/v1/comments/{ai['id']}/parent-visible"
    res = client.put(put, json={"visible": True}, headers=h)
    assert res.status_code == 200 and res.json()["parent_visible"] is True
    assert res.json()["id"] == ai["id"]
    assert [a.object_id for a in _audits(db, "comment.share")] == [ai["id"]]
    res = client.put(put, json={"visible": False}, headers=h)
    assert res.json()["parent_visible"] is False
    assert [a.object_id for a in _audits(db, "comment.unshare")] == [ai["id"]]

    bad = client.put(put, json={"visible": True}, headers=auth(settings, SUBJECT_USER_ID))
    assert bad.status_code == 403
    assert client.put(put, headers=h).status_code == 400
    missing = "/api/v1/comments/00000000-0000-0000-0000-000000000000/parent-visible"
    assert client.put(missing, json={"visible": True}, headers=h).status_code == 404

    _set_ai_review(db, False)
    ai2 = client.post(URL, json={"content": "另一条 AI 评语", "generated_by_ai": True}, headers=h)
    assert ai2.json()["parent_visible"] is True
    _set_ai_review(db, True)
    item = {"student_id": STUDENT_IDS[2], "content": "批量 AI"}
    client.post(BULK, json={"items": [item], "generated_by_ai": True}, headers=h)
    row = db.scalars(select(Comment).where(Comment.content == "批量 AI")).one()
    assert row.parent_visible is False
