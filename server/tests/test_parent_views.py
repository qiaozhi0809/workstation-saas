import json
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, text

from app.domain.parents.lifecycle import close_links_for
from app.domain.school_settings.service import get_switches, save_switches
from app.models import Comment, Enrollment, Exam, Review, Score, Student
from app.models.audit import AuditLog
from app.models.parents import ParentLink
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, EXAM_IDS, SCHOOL_ID, YEAR_ID

LI = "55555555-5555-5555-5555-555555555561"  # 李家长:S0001、S0017 主家长
ZHOU = "55555555-5555-5555-5555-555555555562"  # 周家长:S0001 次要
T01 = "55555555-5555-5555-5555-555555555555"
C41 = "44444444-4444-4444-4444-444444444442"
UNKNOWN = "99999999-9999-9999-9999-999999999999"


def sid(db, mk: str) -> UUID:
    return db.scalar(select(Student.id).where(Student.mk == mk))


def eid(db, mk: str) -> UUID:
    return db.scalar(
        select(Enrollment.id).where(
            Enrollment.student_id == sid(db, mk), Enrollment.status == "active"
        )
    )


def get(client, settings, path, user=LI, **params):
    return client.get(f"/api/v1/parent{path}", params=params, headers=auth(settings, user))


def denials(db, student_id) -> int:
    return len(
        db.scalars(
            select(AuditLog).where(
                AuditLog.action == "parent.view",
                AuditLog.success.is_(False),
                AuditLog.object_id == str(student_id),
            )
        ).all()
    )


def set_switches(db, **changes):
    cur = get_switches(db, UUID(SCHOOL_ID))
    save_switches(db, UUID(SCHOOL_ID), UUID(T01), cur.model_copy(update=changes))


def add_review(db, mk: str, delta: int, text_: str = "测试点评"):
    db.add(
        Review(
            op_id=UUID(int=abs(hash((mk, delta, text_))) % (1 << 100)),
            enrollment_id=eid(db, mk),
            class_id=UUID(CLASS_ID),
            category="individual",
            reason_text=text_,
            score_delta=delta,
            given_by_user_id=UUID(T01),
            given_at=datetime.now(UTC),
        )
    )
    db.flush()


def test_children_list(client, settings, db):
    res = get(client, settings, "/children")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 2
    names = {c["class_name"] for c in items}
    assert names == {"三年二班", "四年一班"}
    assert all(c["status"] == "active" and c["is_primary"] for c in items)
    assert all(c["left_on"] is None and c["archive_on"] is None for c in items)


def test_other_child_forbidden(client, settings, db):
    other = sid(db, "S0002")
    for tail in ("today", "profile", "growth-records", "exams", "comments", "reviews"):
        before = denials(db, other)
        res = get(client, settings, f"/children/{other}/{tail}")
        assert res.status_code == 403, tail
        assert denials(db, other) == before + 1
    res = get(client, settings, f"/children/{UNKNOWN}/today")
    assert res.status_code == 403
    assert denials(db, UNKNOWN) == 1


def test_seat_map_has_no_other_identity(client, settings, db):
    s1 = sid(db, "S0001")
    res = get(client, settings, f"/children/{s1}/today")
    assert res.status_code == 200
    body = res.json()
    active = db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == UUID(CLASS_ID), Enrollment.status == "active"
        )
    ).all()
    seated = [e for e in active if e.seat_row is not None and e.seat_col is not None]
    assert seated and len(body["seat_map"]["occupied"]) == len(seated)
    mine = db.get(Enrollment, eid(db, "S0001"))
    assert body["seat_map"]["mine"] == {"row": mine.seat_row, "col": mine.seat_col}
    raw = json.dumps(body, ensure_ascii=False)
    for e in active:
        s = db.get(Student, e.student_id)
        if s.id == s1:
            continue
        for token in (s.name, str(s.id), str(e.id), s.mk, s.student_no or "\0"):
            assert token not in raw
    assert body["enrollment_id"] == str(eid(db, "S0001"))


def test_today_attendance_states(client, settings, db):
    s1 = sid(db, "S0001")
    path = f"/children/{s1}/today"
    assert get(client, settings, path).json()["attendance"] is None
    assert get(client, settings, path).json()["attendance_confirmed"] is False
    today = get(client, settings, path).json()["date"]
    db.execute(
        text(
            "INSERT INTO attendance_days (class_id, date, confirmed_by_user_id) VALUES (:c, :d, :u)"
        ),
        {"c": CLASS_ID, "d": today, "u": T01},
    )
    body = get(client, settings, path).json()
    assert body["attendance_confirmed"] is True
    assert body["attendance"] == {"status": "present", "reason": None}
    db.execute(
        text(
            "INSERT INTO attendances (enrollment_id, class_id, date, status, reason)"
            " VALUES (:e, :c, :d, 'leave', '发烧')"
        ),
        {"e": eid(db, "S0001"), "c": CLASS_ID, "d": today},
    )
    assert get(client, settings, path).json()["attendance"] == {"status": "leave", "reason": "发烧"}
    old = (date.fromisoformat(today) - timedelta(days=31)).isoformat()
    res = get(client, settings, path, date=old)
    assert res.status_code == 400 and res.json()["error"]["code"] == "DATE_OUT_OF_RANGE"
    future = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
    assert get(client, settings, path, date=future).status_code == 400


def test_switches_apply_immediately(client, settings, db):
    s1 = sid(db, "S0001")
    add_review(db, "S0001", 3, "正向")
    add_review(db, "S0001", -2, "负向")
    base = f"/children/{s1}"

    set_switches(db, parent_negative_review=False)
    today = get(client, settings, f"{base}/today").json()
    assert [r["score_delta"] for r in today["reviews"]] == [3]
    assert today["week_points"] == 3
    assert [r["score_delta"] for r in get(client, settings, f"{base}/reviews").json()["items"]] == [
        3
    ]
    set_switches(db, parent_negative_review=True)
    today = get(client, settings, f"{base}/today").json()
    assert sorted(r["score_delta"] for r in today["reviews"]) == [-2, 3]
    assert today["week_points"] == 1
    assert len(get(client, settings, f"{base}/reviews").json()["items"]) == 2

    exam = f"{base}/exams/{EXAM_IDS[1]}"
    set_switches(db, parent_rank=False)
    d = get(client, settings, exam).json()
    assert d["class_rank"] is None and d["band"] == "前 30%" and d["ranked"] == 10
    set_switches(db, parent_rank=True)
    d = get(client, settings, exam).json()
    assert d["class_rank"] == 2 and d["band"] is None

    cid = db.scalar(
        text(
            "INSERT INTO comments (student_id, enrollment_id, class_id, academic_year_id, semester,"
            " content, generated_by_ai, parent_visible)"
            " VALUES (:s, :e, :c, :y, '2026-2027 第一学期', 'AI 评语', true, false) RETURNING id"
        ),
        {"s": s1, "e": eid(db, "S0001"), "c": CLASS_ID, "y": YEAR_ID},
    )
    contents = [c["content"] for c in get(client, settings, f"{base}/comments").json()["items"]]
    assert "AI 评语" not in contents
    db.get(Comment, cid).parent_visible = True
    db.flush()
    contents = [c["content"] for c in get(client, settings, f"{base}/comments").json()["items"]]
    assert "AI 评语" in contents


def test_profile_fields_per_matrix(client, settings, db):
    s1 = sid(db, "S0001")
    client.put(
        f"/api/v1/students/{s1}/my-notes",
        json={"text": "老师私密笔记"},
        headers=auth(settings, T01),
    )
    res = get(client, settings, f"/children/{s1}/profile")
    assert res.status_code == 200
    body = res.json()
    assert "teacher_notes" not in body and "老师私密笔记" not in res.text
    assert body["can_edit_contacts"] is True
    assert {"family_structure", "name"} <= body.keys()
    # 种子 S0001 没填的字段在响应里缺省(exclude_none)
    assert (
        get(client, settings, f"/children/{s1}/profile", user=ZHOU).json()["can_edit_contacts"]
        is False
    )


def test_profile_has_optional_sections_when_filled(client, settings, db):
    s1 = sid(db, "S0001")
    st = db.get(Student, s1)
    st.personality, st.health_notes, st.tags = "开朗", "近视", ["近视"]
    st.contacts = [{"name": "李妈", "relation": "母亲", "phone": "13800000061", "job": "医生"}]
    db.flush()
    body = get(client, settings, f"/children/{s1}/profile").json()
    assert body["personality"] == "开朗" and body["health_notes"] == "近视"
    assert body["tags"] == ["近视"] and body["contacts"][0]["name"] == "李妈"


def test_contacts_write_rules(client, settings, db):
    s1 = sid(db, "S0001")
    path = f"/api/v1/parent/children/{s1}/contacts"
    c = {"name": "李妈", "relation": "母亲", "phone": "13800000061", "job": "医生"}
    res = client.put(path, json={"contacts": [c]}, headers=auth(settings, LI))
    assert res.status_code == 200 and res.json()["contacts"][0]["name"] == "李妈"
    assert db.scalars(
        select(AuditLog).where(
            AuditLog.action == "student.parent_update", AuditLog.object_id == str(s1)
        )
    ).all()
    res = client.put(path, json={"contacts": [c]}, headers=auth(settings, ZHOU))
    assert res.status_code == 403
    assert db.get(Student, s1).contacts[0]["name"] == "李妈"
    res = client.put(path, json={"contacts": [c, c, c]}, headers=auth(settings, LI))
    # 项目口径:校验失败统一 400 BAD_REQUEST(不是 422)
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"


def test_exam_of_other_class_forbidden(client, settings, db):
    other = Exam(
        class_id=UUID(C41),
        academic_year_id=UUID(YEAR_ID),
        name="别班考试",
        exam_type="月考",
        date=date(2026, 10, 1),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(other)
    db.flush()
    s1 = sid(db, "S0001")
    res = get(client, settings, f"/children/{s1}/exams/{other.id}")
    assert res.status_code == 403
    row = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "parent.view",
            AuditLog.object_id == str(s1),
            AuditLog.success.is_(False),
        )
    ).one()
    assert row.object_type == "student" and row.extra == {"exam_id": str(other.id)}
    assert str(other.id) not in [
        e["id"] for e in get(client, settings, f"/children/{s1}/exams").json()
    ]
    # 自己班的考试:统计与 exam_table 一致
    from app.ai.stats import exam_table
    from app.domain.exams.schemas import SubjectFull
    from app.models import Score

    ex = db.get(Exam, UUID(EXAM_IDS[1]))
    ids = list(
        db.scalars(
            select(Enrollment.id)
            .join(Student, Student.id == Enrollment.student_id)
            .where(Enrollment.class_id == UUID(CLASS_ID), Enrollment.status != "removed")
            .order_by(Student.mk)
        )
    )
    scores: dict = {}
    for e, s, v in db.execute(
        select(Score.enrollment_id, Score.subject, Score.value).where(Score.exam_id == ex.id)
    ):
        scores.setdefault(e, {})[s] = v
    table = exam_table([SubjectFull(**x) for x in ex.subjects], scores, ids)
    mine = next(r for r in table if r.enrollment_id == eid(db, "S0001"))
    body = get(client, settings, f"/children/{s1}/exams/{EXAM_IDS[1]}").json()
    assert body["total"] == mine.total and body["total_full"] == 300
    chinese = body["subjects"][0]
    vals = [r.subs["语文"] for r in table if r.subs["语文"] is not None]
    assert chinese["class_max"] == max(vals)
    assert chinese["class_avg"] == round(sum(vals) / len(vals), 1)
    assert chinese["score"] == mine.subs["语文"]


def test_readonly_child(client, settings, db):
    s17 = sid(db, "S0017")
    ex = Exam(
        class_id=UUID(C41),
        academic_year_id=UUID(YEAR_ID),
        name="往年考试",
        exam_type="期末",
        date=date(2026, 9, 20),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(ex)
    db.execute(
        text("UPDATE enrollments SET status = 'graduated' WHERE student_id = :s"), {"s": s17}
    )
    close_links_for(db, [s17], datetime.now(UTC))
    db.flush()
    body = get(client, settings, f"/children/{s17}/today").json()
    assert (
        body["status"] == "readonly" and body["seat_map"] is None and body["enrollment_id"] is None
    )
    assert body["attendance"] is None and body["attendance_confirmed"] is False
    assert body["class_info"]["class_name"] == "四年一班"
    child = next(
        c
        for c in get(client, settings, "/children").json()
        if c["name"] == db.get(Student, s17).name
    )
    assert child["status"] == "readonly" and child["left_on"] and child["archive_on"]
    assert ex.name in [e["name"] for e in get(client, settings, f"/children/{s17}/exams").json()]
    res = client.put(
        f"/api/v1/parent/children/{s17}/contacts", json={"contacts": []}, headers=auth(settings, LI)
    )
    assert res.status_code == 403
    assert get(client, settings, f"/children/{s17}/profile").status_code == 200


def test_expired_readonly_forbidden_without_cli(client, settings, db):
    s17 = sid(db, "S0017")
    db.execute(
        text("UPDATE enrollments SET status = 'graduated' WHERE student_id = :s"), {"s": s17}
    )
    close_links_for(db, [s17], datetime.now(UTC))
    link = db.scalars(select(ParentLink).where(ParentLink.student_id == s17)).one()
    link.readonly_since = datetime.now(UTC) - timedelta(days=365, seconds=5)
    db.flush()
    assert [c["class_name"] for c in get(client, settings, "/children").json()] == ["三年二班"]
    assert get(client, settings, f"/children/{s17}/today").status_code == 403
    assert denials(db, s17) == 1


T04 = "55555555-5555-5555-5555-555555555541"  # 孙老师,同时是 S0002 的主家长


def test_removed_child_still_readable(client, settings, db):
    s2 = sid(db, "S0002")
    add_review(db, "S0002", 2, "历史点评")
    db.execute(
        text("UPDATE enrollments SET status = 'removed', left_at = now() WHERE student_id = :s"),
        {"s": s2},
    )
    close_links_for(db, [s2], datetime.now(UTC))
    db.flush()
    kids = get(client, settings, "/children", user=T04).json()
    assert [(k["class_name"], k["status"]) for k in kids] == [("三年二班", "readonly")]
    assert get(client, settings, f"/children/{s2}/profile", user=T04).status_code == 200
    assert get(client, settings, f"/children/{s2}/today", user=T04).status_code == 200
    exams = get(client, settings, f"/children/{s2}/exams", user=T04).json()
    assert {e["id"] for e in exams} == set(EXAM_IDS)
    detail = get(client, settings, f"/children/{s2}/exams/{EXAM_IDS[1]}", user=T04)
    assert detail.status_code == 200 and detail.json()["total"] is not None
    items = get(client, settings, f"/children/{s2}/reviews", user=T04).json()["items"]
    assert "历史点评" in [r["reason_text"] for r in items]


def test_reviews_cursor_paging(client, settings, db):
    s1 = sid(db, "S0001")
    base = datetime.now(UTC) - timedelta(hours=1)
    for i in range(35):
        db.add(
            Review(
                op_id=uuid4(),
                enrollment_id=eid(db, "S0001"),
                class_id=UUID(CLASS_ID),
                category="individual",
                reason_text=f"点评{i}",
                score_delta=1,
                given_by_user_id=UUID(T01),
                given_at=base + timedelta(seconds=i),
            )
        )
    db.flush()
    path = f"/children/{s1}/reviews"
    p1 = get(client, settings, path).json()
    assert len(p1["items"]) == 30 and p1["next_cursor"]
    p2 = get(client, settings, path, cursor=p1["next_cursor"]).json()
    assert len(p2["items"]) == 5 and p2["next_cursor"] is None
    texts = [r["reason_text"] for r in p1["items"] + p2["items"]]
    assert texts == [f"点评{i}" for i in range(34, -1, -1)]
    res = get(client, settings, path, cursor="not-a-cursor")
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"


def test_growth_records_content(client, settings, db):
    s1 = sid(db, "S0001")
    items = get(client, settings, f"/children/{s1}/growth-records").json()["items"]
    assert [i["type"] for i in items] == ["谈话", "表扬"]
    assert [i["date"] for i in items] == ["2026-10-28", "2026-10-20"]
    year_name = db.scalar(text("SELECT name FROM academic_years WHERE id = :y"), {"y": YEAR_ID})
    for i in items:
        assert set(i) == {"id", "type", "date", "content", "year_name", "created_by_name"}
        assert i["year_name"] == year_name and i["created_by_name"] == "张老师"


def test_secondary_put_denied_with_audit(client, settings, db):
    s1 = sid(db, "S0001")
    res = client.put(
        f"/api/v1/parent/children/{s1}/contacts",
        json={"contacts": []},
        headers=auth(settings, ZHOU),
    )
    assert res.status_code == 403 and denials(db, s1) == 1


def test_exam_detail_with_other_childs_id(client, settings, db):
    s2 = sid(db, "S0002")
    res = get(client, settings, f"/children/{s2}/exams/{EXAM_IDS[0]}")
    assert res.status_code == 403 and denials(db, s2) == 1


def test_teacher_without_parent_identity_forbidden(client, settings, db):
    s1 = sid(db, "S0001")
    assert get(client, settings, "/children", user=T01).json() == []
    assert get(client, settings, f"/children/{s1}/today", user=T01).status_code == 403
    assert denials(db, s1) == 1


def _band_exam(db, count: int) -> Exam:
    exam = Exam(
        class_id=UUID(CLASS_ID),
        academic_year_id=UUID(YEAR_ID),
        name="段位边界",
        exam_type="月考",
        date=date(2026, 10, 2),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(exam)
    db.flush()
    for n in range(1, count + 1):
        db.add(
            Score(
                exam_id=exam.id, enrollment_id=eid(db, f"S{n:04d}"), subject="语文", value=101 - n
            )
        )
    db.flush()
    return exam


def test_band_boundary(client, settings, db):
    s1 = sid(db, "S0001")
    nine = _band_exam(db, 9)
    body = get(client, settings, f"/children/{s1}/exams/{nine.id}").json()
    assert body["ranked"] == 9 and body["band"] is None
    db.add(Score(exam_id=nine.id, enrollment_id=eid(db, "S0010"), subject="语文", value=1))
    db.flush()
    body = get(client, settings, f"/children/{s1}/exams/{nine.id}").json()
    assert body["ranked"] == 10 and body["band"] == "前 10%"


def test_class_info_content(client, settings, db):
    s1 = sid(db, "S0001")
    info = get(client, settings, f"/children/{s1}/today").json()["class_info"]
    assert info["class_name"] == "三年二班" and info["homeroom_name"] == "张老师"
    assert {"subject": "语文", "name": "张老师"} in info["teachers"]
    assert "数学" in [t["subject"] for t in info["teachers"]]
    assert all(t["subject"] for t in info["teachers"])
