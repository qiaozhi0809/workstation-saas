from datetime import date
from uuid import UUID

from sqlalchemy import select

from app.models import AcademicYear, Enrollment, Exam, GradeExam, Score
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, TEACHER_USER_ID

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"  # gradehead03:三年级
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER04 = "55555555-5555-5555-5555-555555555541"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"
CLASS_31 = "44444444-4444-4444-4444-444444444441"  # 三年一班
CLASS_41 = "44444444-4444-4444-4444-444444444442"  # 四年一班
API = "/api/v1/admin/grade-exams"


def _body(grade_id=GRADE_ID, name="期中联考", subjects=None, date="2026-11-10"):
    return {
        "grade_id": grade_id,
        "name": name,
        "exam_type": "期中",
        "date": date,
        "subjects": subjects or [{"name": "语文", "full": 100}, {"name": "数学", "full": 100}],
    }


def _create(client, settings, body=None, user=DEAN):
    r = client.post(API, json=body or _body(), headers=auth(settings, user))
    assert r.status_code == 201, r.text
    return r.json()


def _class_exams(db, grade_exam_id):
    return list(db.scalars(select(Exam).where(Exam.grade_exam_id == UUID(grade_exam_id))).all())


def _score(db, exam_id, class_id, subject, value, idx=0):
    """给 class_id 班第 idx 个在读学生录一格分(假数据)。"""
    ids = db.scalars(
        select(Enrollment.id)
        .where(Enrollment.class_id == UUID(str(class_id)), Enrollment.status == "active")
        .order_by(Enrollment.id)
    ).all()
    db.add(Score(exam_id=UUID(str(exam_id)), enrollment_id=ids[idx], subject=subject, value=value))
    db.flush()


def _exam_of(db, grade_exam_id, class_id):
    return db.scalars(
        select(Exam).where(
            Exam.grade_exam_id == UUID(grade_exam_id), Exam.class_id == UUID(class_id)
        )
    ).one()


def test_create_creates_class_exams(client, db, settings):
    out = _create(client, settings)
    assert out["grade_name"] == "三年级" and out["grade_id"] == GRADE_ID
    assert out["name"] == "期中联考" and out["exam_type"] == "期中" and out["date"] == "2026-11-10"
    assert [c["class_name"] for c in out["classes"]] == ["三年一班", "三年二班"]
    assert out["missing_classes"] == []
    exams = _class_exams(db, out["id"])
    assert {str(e.class_id) for e in exams} == {CLASS_ID, CLASS_31}
    for e in exams:
        assert e.name == "期中联考" and e.exam_type == "期中"
        assert e.subjects == [{"name": "语文", "full": 100}, {"name": "数学", "full": 100}]
        assert str(e.created_by_user_id) == DEAN
        assert str(e.grade_exam_id) == out["id"]
    assert not db.scalars(select(Exam).where(Exam.class_id == UUID(CLASS_41))).all()
    by_class = {c["class_id"]: c for c in out["classes"]}
    assert by_class[CLASS_ID]["expected"] == 10 * 2
    assert by_class[CLASS_31]["expected"] == 6 * 2
    assert by_class[CLASS_ID]["entered"] == 0
    assert by_class[CLASS_ID]["exam_id"] == str(_exam_of(db, out["id"], CLASS_ID).id)
    assert [r.action for r in audit_rows(db, out["id"])] == ["exam.grade_create"]
    assert audit_rows(db, out["id"])[0].object_type == "grade_exam"


def test_create_validation(client, settings):
    h = auth(settings, DEAN)
    bad = _body(subjects=[{"name": "语文", "full": 100}, {"name": "语文", "full": 50}])
    assert client.post(API, json=bad, headers=h).status_code == 400
    assert client.post(API, json=_body(name=""), headers=h).status_code == 400
    assert client.post(API, json=_body(name="长" * 31), headers=h).status_code == 400


def test_grade_head_only_own_grade(client, db, settings):
    r = client.post(API, json=_body(GRADE4_ID), headers=auth(settings, GRADE_HEAD))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"
    denied = [a for a in audit_rows(db, SCHOOL_ID) if a.action == "exam.grade_write"]
    assert [a.success for a in denied] == [False]
    own = client.post(API, json=_body(), headers=auth(settings, GRADE_HEAD))
    assert own.status_code == 201
    assert client.post(API, json=_body(GRADE4_ID), headers=auth(settings, DEAN)).status_code == 201


def test_write_forbidden_for_teacher_and_it_admin(client, settings):
    for uid in (TEACHER_USER_ID, IT_ADMIN):
        assert client.post(API, json=_body(), headers=auth(settings, uid)).status_code == 403


def test_list_visible_grades_only(client, settings):
    a = _create(client, settings, _body(GRADE_ID, "三年级联考", date="2026-11-10"))
    b = _create(client, settings, _body(GRADE4_ID, "四年级联考", date="2026-11-12"))
    for uid in (PRINCIPAL, DEAN):
        items = client.get(API, headers=auth(settings, uid)).json()
        assert [i["id"] for i in items][:2] == [b["id"], a["id"]]  # 日期倒序
    mine = client.get(API, headers=auth(settings, GRADE_HEAD)).json()
    assert [i["id"] for i in mine] == [a["id"]]
    only4 = client.get(f"{API}?grade_id={GRADE4_ID}", headers=auth(settings, DEAN)).json()
    assert [i["id"] for i in only4] == [b["id"]]
    assert (
        client.get(f"{API}?grade_id={GRADE4_ID}", headers=auth(settings, GRADE_HEAD)).json() == []
    )
    assert client.get(API, headers=auth(settings, TEACHER_USER_ID)).status_code == 403
    assert client.get(API, headers=auth(settings, IT_ADMIN)).status_code == 403


def test_progress_counts_entered_cells(client, db, settings):
    out = _create(client, settings)
    ex = _exam_of(db, out["id"], CLASS_ID)
    _score(db, ex.id, CLASS_ID, "语文", 90, 0)
    _score(db, ex.id, CLASS_ID, "数学", None, 0)  # 缺考也算录了
    _score(db, ex.id, CLASS_ID, "语文", 80, 1)
    got = client.get(API, headers=auth(settings, DEAN)).json()
    mine = next(g for g in got if g["id"] == out["id"])
    by_class = {c["class_id"]: c for c in mine["classes"]}
    assert by_class[CLASS_ID]["entered"] == 3 and by_class[CLASS_ID]["expected"] == 20
    assert by_class[CLASS_31]["entered"] == 0


def test_update_syncs_and_rejects(client, db, settings):
    out = _create(client, settings)
    body = _body(name="期中联考(改)", date="2026-11-12")
    r = client.put(f"{API}/{out['id']}", json=body, headers=auth(settings, DEAN))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "期中联考(改)" and r.json()["date"] == "2026-11-12"
    for e in _class_exams(db, out["id"]):
        assert e.name == "期中联考(改)" and str(e.date) == "2026-11-12"
    assert db.get(GradeExam, UUID(out["id"])).name == "期中联考(改)"
    # grade_id 不能变
    r = client.put(f"{API}/{out['id']}", json=_body(GRADE4_ID), headers=auth(settings, DEAN))
    assert r.status_code == 400
    # 改科目与满分、加科目
    body = _body(
        subjects=[
            {"name": "语文", "full": 120},
            {"name": "数学", "full": 100},
            {"name": "英语", "full": 100},
        ]
    )
    r = client.put(f"{API}/{out['id']}", json=body, headers=auth(settings, GRADE_HEAD))
    assert r.status_code == 200
    for e in _class_exams(db, out["id"]):
        assert [s["name"] for s in e.subjects] == ["语文", "数学", "英语"]
        assert e.subjects[0]["full"] == 120
    assert [a.action for a in audit_rows(db, out["id"])] == [
        "exam.grade_create",
        "exam.grade_update",
        "exam.grade_update",
    ]
    # 非本年级的年级组长不能改
    other = _create(client, settings, _body(GRADE4_ID))
    r = client.put(
        f"{API}/{other['id']}", json=_body(GRADE4_ID), headers=auth(settings, GRADE_HEAD)
    )
    assert r.status_code == 403
    assert (
        client.put(
            f"{API}/{out['id']}", json=_body(), headers=auth(settings, TEACHER_USER_ID)
        ).status_code
        == 403
    )


def test_remove_scored_subject_rejected(client, db, settings):
    out = _create(client, settings)
    _score(db, _exam_of(db, out["id"], CLASS_31).id, CLASS_31, "数学", 70)
    only_chinese = _body(subjects=[{"name": "语文", "full": 100}])
    r = client.put(f"{API}/{out['id']}", json=only_chinese, headers=auth(settings, DEAN))
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "EXAM_HAS_SCORES" and err["details"] == {"subject": "数学"}
    assert "数学" in err["message"]
    assert db.get(GradeExam, UUID(out["id"])).subjects[1]["name"] == "数学"
    assert all(len(e.subjects) == 2 for e in _class_exams(db, out["id"]))
    assert len(db.scalars(select(Score)).all()) >= 1
    # 去掉没分的科目成功
    only_math = _body(subjects=[{"name": "数学", "full": 100}])
    r = client.put(f"{API}/{out['id']}", json=only_math, headers=auth(settings, DEAN))
    assert r.status_code == 200
    assert all([s["name"] for s in e.subjects] == ["数学"] for e in _class_exams(db, out["id"]))
    # 去掉后 expected 随科目数变化
    assert {c["expected"] for c in r.json()["classes"]} == {10, 6}


def test_lower_full_below_scores_rejected(client, db, settings):
    out = _create(client, settings)
    _score(db, _exam_of(db, out["id"], CLASS_ID).id, CLASS_ID, "语文", 95)
    low = _body(subjects=[{"name": "语文", "full": 90}, {"name": "数学", "full": 100}])
    r = client.put(f"{API}/{out['id']}", json=low, headers=auth(settings, DEAN))
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "SCORE_ABOVE_FULL" and err["details"] == {"subject": "语文"}
    assert "语文" in err["message"]
    ok = _body(subjects=[{"name": "语文", "full": 95}, {"name": "数学", "full": 100}])
    assert (
        client.put(f"{API}/{out['id']}", json=ok, headers=auth(settings, DEAN)).status_code == 200
    )


def test_delete_with_scores_rejected(client, db, settings):
    out = _create(client, settings)
    _score(db, _exam_of(db, out["id"], CLASS_ID).id, CLASS_ID, "语文", 88)
    r = client.delete(f"{API}/{out['id']}", headers=auth(settings, DEAN))
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXAM_HAS_SCORES"
    assert len(_class_exams(db, out["id"])) == 2
    assert [a.action for a in audit_rows(db, out["id"])] == ["exam.grade_create"]


def test_delete_cascades(client, db, settings):
    out = _create(client, settings)
    assert (
        client.delete(f"{API}/{out['id']}", headers=auth(settings, GRADE_HEAD)).status_code == 204
    )
    assert db.get(GradeExam, UUID(out["id"])) is None
    assert _class_exams(db, out["id"]) == []
    assert [a.action for a in audit_rows(db, out["id"])] == [
        "exam.grade_create",
        "exam.grade_delete",
    ]
    assert client.delete(f"{API}/{out['id']}", headers=auth(settings, DEAN)).status_code == 404
    other = _create(client, settings, _body(GRADE4_ID))
    assert (
        client.delete(f"{API}/{other['id']}", headers=auth(settings, GRADE_HEAD)).status_code == 403
    )


def test_sync_adds_missing_classes(client, db, settings):
    out = _create(client, settings)
    r = client.post(
        "/api/v1/admin/classes",
        json={"grade_id": GRADE_ID, "name": "三年三班", "room": "求知楼 203"},
        headers=auth(settings, PRINCIPAL),
    )
    assert r.status_code == 201, r.text
    new_class = r.json()["id"]
    listed = next(
        g for g in client.get(API, headers=auth(settings, DEAN)).json() if g["id"] == out["id"]
    )
    assert listed["missing_classes"] == [{"class_id": new_class, "class_name": "三年三班"}]
    assert len(listed["classes"]) == 2
    r = client.post(f"{API}/{out['id']}/sync", headers=auth(settings, GRADE_HEAD))
    assert r.status_code == 200, r.text
    assert r.json()["missing_classes"] == []
    assert [c["class_name"] for c in r.json()["classes"]] == ["三年一班", "三年三班", "三年二班"]
    added = _exam_of(db, out["id"], new_class)
    assert added.name == "期中联考" and str(added.created_by_user_id) == GRADE_HEAD
    assert [a.action for a in audit_rows(db, out["id"])] == ["exam.grade_create", "exam.grade_sync"]
    assert (
        client.post(f"{API}/{out['id']}/sync", headers=auth(settings, TEACHER_USER_ID)).status_code
        == 403
    )
    # 再同步一次没有变化
    again = client.post(f"{API}/{out['id']}/sync", headers=auth(settings, DEAN))
    assert again.status_code == 200 and len(again.json()["classes"]) == 3


def test_get_unknown_or_other_school_is_404(client, settings):
    missing = "99999999-9999-9999-9999-999999999999"
    h = auth(settings, DEAN)
    assert client.put(f"{API}/{missing}", json=_body(), headers=h).status_code == 404
    assert client.delete(f"{API}/{missing}", headers=h).status_code == 404
    assert client.post(f"{API}/{missing}/sync", headers=h).status_code == 404
    unknown_grade = _body("99999999-9999-9999-9999-999999999999")
    r = client.post(API, json=unknown_grade, headers=h)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_past_year_grade_exam_is_404(client, db, settings):
    out = _create(client, settings)
    ge = db.get(GradeExam, UUID(out["id"]))
    old = AcademicYear(
        school_id=UUID(SCHOOL_ID),
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 7, 15),
        is_active=False,
    )
    db.add(old)
    db.flush()
    ge.academic_year_id = old.id
    db.flush()
    h = auth(settings, DEAN)
    assert client.get(API, headers=h).json() == []
    for r in (
        client.put(f"{API}/{out['id']}", json=_body(), headers=h),
        client.delete(f"{API}/{out['id']}", headers=h),
        client.post(f"{API}/{out['id']}/sync", headers=h),
    ):
        assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_remove_subject_with_only_absent_rows_rejected(client, db, settings):
    out = _create(client, settings)
    _score(db, _exam_of(db, out["id"], CLASS_ID).id, CLASS_ID, "数学", None)  # 只有缺考
    r = client.put(
        f"{API}/{out['id']}",
        json=_body(subjects=[{"name": "语文", "full": 100}]),
        headers=auth(settings, DEAN),
    )
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "EXAM_HAS_SCORES" and err["details"] == {"subject": "数学"}
    assert "数学" in err["message"]


def test_class_exam_out_has_grade_exam_id(client, db, settings):
    out = _create(client, settings)
    exam_id = str(_exam_of(db, out["id"], CLASS_ID).id)
    items = client.get(f"/api/v1/classes/{CLASS_ID}/exams", headers=auth(settings)).json()["items"]
    linked = next(e for e in items if e["id"] == exam_id)
    assert linked["grade_exam_id"] == out["id"]
    assert all(e["grade_exam_id"] is None for e in items if e["id"] != exam_id)
