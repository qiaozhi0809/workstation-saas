from uuid import UUID

import pytest
from sqlalchemy import select

from app.domain.exams.subjects import stage_of
from app.models import Enrollment, Score
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    EXAM_IDS,
    STUDENT_IDS,
    SUBJECT_USER_ID,
)

EXAMS = f"/api/v1/classes/{CLASS_ID}/exams"


def _body(subjects=None, name="科学小测"):
    return {
        "name": name,
        "exam_type": "周测",
        "date": "2026-11-02",
        "subjects": subjects or [{"name": "科学", "full": 50}, {"name": "书法", "full": 20}],
    }


def _create(client, settings, body=None, user=None):
    headers = auth(settings, user) if user else auth(settings)
    r = client.post(EXAMS, json=body or _body(), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _put_score(db, exam_id, subject, value, student_idx=0):
    db.add(
        Score(
            exam_id=UUID(exam_id),
            enrollment_id=enrollment_of(db, STUDENT_IDS[student_idx]),
            subject=subject,
            value=value,
        )
    )
    db.flush()


def _scores(db, exam_id):
    return list(db.scalars(select(Score).where(Score.exam_id == UUID(exam_id))).all())


def test_stage_of():
    assert stage_of("三年级") == "primary"
    assert stage_of("初二") == "junior"
    assert stage_of("七年级") == "junior"
    assert stage_of("高一") == "senior"
    assert stage_of("国际部") == "junior"


def test_class_subjects_defaults_to_stage_preset(client, settings):
    r = client.get(f"/api/v1/classes/{CLASS_ID}/subjects", headers=auth(settings))
    assert r.status_code == 200
    assert r.json()["items"] == [
        {"name": n, "full": 100} for n in ["语文", "数学", "英语", "科学", "道法"]
    ]


def test_subjects_forbidden_for_assistant(client, settings, db):
    r = client.get(
        f"/api/v1/classes/{CLASS_ID}/subjects", headers=auth(settings, ASSISTANT_USER_ID)
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"
    assert [(a.action, a.success) for a in audit_rows(db, CLASS_ID)] == [("exam.read", False)]


def test_list_exams_newest_first_with_progress(client, settings):
    items = client.get(EXAMS, headers=auth(settings)).json()["items"]
    assert [e["id"] for e in items] == [EXAM_IDS[1], EXAM_IDS[0]]
    assert items[0]["progress"] == {"entered": 10, "total": 10}  # 缺考也算有记录
    assert items[0]["created_by_me"] is True


def test_create_exam_writes_back_new_subject(client, settings):
    r = client.post(EXAMS, json=_body(), headers=auth(settings))
    assert r.status_code == 201 and r.json()["progress"] == {"entered": 0, "total": 10}
    url = f"/api/v1/classes/{CLASS_ID}/subjects"
    got = client.get(url, headers=auth(settings)).json()["items"]
    assert [s["name"] for s in got] == ["语文", "数学", "英语", "科学", "道法", "书法"]
    assert {s["name"]: s["full"] for s in got}["科学"] == 100  # 预设满分不被覆盖
    assert {s["name"]: s["full"] for s in got}["书法"] == 20
    body2 = _body([{"name": "书法", "full": 30}, {"name": "美术", "full": 10}], name="另一场")
    assert client.post(EXAMS, json=body2, headers=auth(settings)).status_code == 201
    got = client.get(url, headers=auth(settings)).json()["items"]
    assert [s["name"] for s in got] == ["语文", "数学", "英语", "科学", "道法", "书法", "美术"]


@pytest.mark.parametrize(
    "patch",
    [
        {"name": "考" * 31},
        {"name": "   "},
        {"subjects": []},
        {"subjects": [{"name": "语文", "full": 100}, {"name": " 语文 ", "full": 50}]},
        {"subjects": [{"name": "语文", "full": 0}]},
        {"subjects": [{"name": "语文", "full": 10.5}]},
        {"subjects": [{"name": f"科{i}", "full": 10} for i in range(21)]},
    ],
)
def test_exam_input_validation(client, settings, patch):
    r = client.post(EXAMS, json={**_body(), **patch}, headers=auth(settings))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "BAD_REQUEST"


def test_subject_teacher_exam_subjects_limited(client, settings):
    ok = _create(client, settings, _body([{"name": "数学", "full": 100}]), SUBJECT_USER_ID)
    assert ok["created_by_me"] is True
    r = client.post(
        EXAMS,
        json=_body([{"name": "数学", "full": 100}, {"name": "语文", "full": 100}]),
        headers=auth(settings, SUBJECT_USER_ID),
    )
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "SUBJECT_NOT_ALLOWED" and err["details"] == {"subject": "语文"}


def test_subject_teacher_sees_only_exams_with_own_subject(client, settings):
    english = _create(client, settings, _body([{"name": "英语", "full": 100}], "英语测"))
    teacher = auth(settings, SUBJECT_USER_ID)
    items = client.get(EXAMS, headers=teacher).json()["items"]
    assert english["id"] not in [e["id"] for e in items]
    assert [e["id"] for e in items] == [EXAM_IDS[1], EXAM_IDS[0]]
    assert all(e["subjects"] == [{"name": "数学", "full": 100}] for e in items)
    # 分数接口在 Task 3 才有;这里先确认改 / 删对不可见考试同样 404
    for call in (
        lambda: client.put(
            f"{EXAMS}/{english['id']}", json=_body([{"name": "数学", "full": 100}]), headers=teacher
        ),
        lambda: client.delete(f"{EXAMS}/{english['id']}", headers=teacher),
    ):
        r = call()
        assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_subject_teacher_cannot_edit_others_exam(client, settings, db):
    teacher = auth(settings, SUBJECT_USER_ID)
    body = _body([{"name": "数学", "full": 100}])
    assert client.put(f"{EXAMS}/{EXAM_IDS[0]}", json=body, headers=teacher).status_code == 403
    assert client.delete(f"{EXAMS}/{EXAM_IDS[0]}", headers=teacher).status_code == 403
    rows = audit_rows(db, EXAM_IDS[0])
    assert [(a.action, a.success, a.object_type) for a in rows] == [
        ("exam.write", False, "exam"),
        ("exam.write", False, "exam"),
    ]


def test_update_exam_drops_removed_subject_scores(client, settings, db):
    exam = _create(
        client, settings, _body([{"name": "英语", "full": 100}, {"name": "数学", "full": 100}])
    )
    _put_score(db, exam["id"], "英语", 80)
    _put_score(db, exam["id"], "数学", 70)
    r = client.put(
        f"{EXAMS}/{exam['id']}", json=_body([{"name": "数学", "full": 100}]), headers=auth(settings)
    )
    assert r.status_code == 200 and r.json()["subjects"] == [{"name": "数学", "full": 100}]
    assert [s.subject for s in _scores(db, exam["id"])] == ["数学"]
    assert [a.action for a in audit_rows(db, exam["id"])] == ["exam.create", "exam.update"]


def test_update_full_below_scores_rejected(client, settings):
    subjects = [
        {"name": "语文", "full": 90},
        {"name": "数学", "full": 100},
        {"name": "英语", "full": 100},
    ]
    r = client.put(f"{EXAMS}/{EXAM_IDS[1]}", json=_body(subjects), headers=auth(settings))
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "FULL_BELOW_SCORES" and err["details"] == {"subject": "语文"}


def test_delete_exam_cascades_and_audits(client, settings, db):
    exam = _create(client, settings)
    _put_score(db, exam["id"], "科学", 40)
    r = client.delete(f"{EXAMS}/{exam['id']}", headers=auth(settings))
    assert r.status_code == 204
    db.expire_all()
    assert _scores(db, exam["id"]) == []
    assert [a.action for a in audit_rows(db, exam["id"])] == ["exam.create", "exam.delete"]
    ids = [e["id"] for e in client.get(EXAMS, headers=auth(settings)).json()["items"]]
    assert exam["id"] not in ids


def test_assistant_cannot_create_exam(client, settings):
    r = client.post(EXAMS, json=_body(), headers=auth(settings, ASSISTANT_USER_ID))
    assert r.status_code == 403


def _mixed_exam(client, settings, db):
    """Math teacher's 数学 exam, which the homeroom teacher extends with 语文 (+ a score each)."""
    exam = _create(client, settings, _body([{"name": "数学", "full": 100}]), SUBJECT_USER_ID)
    both = _body([{"name": "数学", "full": 100}, {"name": "语文", "full": 100}])
    r = client.put(f"{EXAMS}/{exam['id']}", json=both, headers=auth(settings))
    assert r.status_code == 200
    _put_score(db, exam["id"], "语文", 77)
    _put_score(db, exam["id"], "数学", 66)
    return exam


def test_subject_teacher_update_keeps_hidden_subjects(client, settings, db):
    exam = _mixed_exam(client, settings, db)
    teacher = auth(settings, SUBJECT_USER_ID)
    r = client.put(
        f"{EXAMS}/{exam['id']}",
        json=_body([{"name": "数学", "full": 120}], name="改名后"),
        headers=teacher,
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "改名后" and r.json()["subjects"] == [{"name": "数学", "full": 120}]
    db.expire_all()
    assert sorted(s.subject for s in _scores(db, exam["id"])) == ["数学", "语文"]
    got = client.get(EXAMS, headers=auth(settings)).json()["items"]
    mine = next(e for e in got if e["id"] == exam["id"])
    assert mine["name"] == "改名后"
    assert mine["subjects"] == [{"name": "数学", "full": 120}, {"name": "语文", "full": 100}]


def test_subject_teacher_removing_own_subject_keeps_hidden_ones(client, settings, db):
    exam = _mixed_exam(client, settings, db)
    r = client.put(
        f"{EXAMS}/{exam['id']}",
        json=_body([{"name": "数学", "full": 100}]),
        headers=auth(settings, SUBJECT_USER_ID),
    )
    assert r.status_code == 200
    # 语文 位置不变,新增的可写科目追加在末尾
    got = client.get(EXAMS, headers=auth(settings)).json()["items"]
    mine = next(e for e in got if e["id"] == exam["id"])
    assert [s["name"] for s in mine["subjects"]] == ["数学", "语文"]


def test_full_below_ignores_removed_students_scores(client, settings, db):
    exam = _create(client, settings)
    _put_score(db, exam["id"], "科学", 45, student_idx=5)
    _put_score(db, exam["id"], "科学", 20, student_idx=0)
    body = _body([{"name": "科学", "full": 30}, {"name": "书法", "full": 20}])
    assert client.put(f"{EXAMS}/{exam['id']}", json=body, headers=auth(settings)).status_code == 400
    db.get(Enrollment, enrollment_of(db, STUDENT_IDS[5])).status = "removed"
    db.flush()
    r = client.put(f"{EXAMS}/{exam['id']}", json=body, headers=auth(settings))
    assert r.status_code == 200, r.text


def test_subject_teacher_cannot_delete_exam_with_foreign_subjects(client, settings, db):
    exam = _mixed_exam(client, settings, db)
    r = client.delete(f"{EXAMS}/{exam['id']}", headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    db.expire_all()
    assert sorted(s.subject for s in _scores(db, exam["id"])) == ["数学", "语文"]
    denied = [a for a in audit_rows(db, exam["id"]) if not a.success]
    assert [(a.action, a.object_type) for a in denied] == [("exam.write", "exam")]


def test_subject_teacher_can_delete_own_only_exam(client, settings, db):
    exam = _create(client, settings, _body([{"name": "数学", "full": 100}]), SUBJECT_USER_ID)
    _put_score(db, exam["id"], "数学", 66)
    r = client.delete(f"{EXAMS}/{exam['id']}", headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 204
    db.expire_all()
    assert _scores(db, exam["id"]) == []


def test_homeroom_update_keeps_requested_subject_order(client, settings):
    exam = _create(
        client, settings, _body([{"name": "数学", "full": 100}, {"name": "语文", "full": 100}])
    )
    swapped = _body([{"name": "语文", "full": 100}, {"name": "数学", "full": 100}])
    r = client.put(f"{EXAMS}/{exam['id']}", json=swapped, headers=auth(settings))
    assert r.status_code == 200
    got = client.get(EXAMS, headers=auth(settings)).json()["items"]
    mine = next(e for e in got if e["id"] == exam["id"])
    assert [s["name"] for s in mine["subjects"]] == ["语文", "数学"]


def _grade_linked_exam(client, settings, db):
    dean = "55555555-5555-5555-5555-555555555544"
    r = client.post(
        "/api/v1/admin/grade-exams",
        json={
            "grade_id": "33333333-3333-3333-3333-333333333333",
            "name": "期中联考",
            "exam_type": "期中",
            "date": "2026-11-10",
            "subjects": [{"name": "语文", "full": 100}, {"name": "数学", "full": 100}],
        },
        headers=auth(settings, dean),
    )
    assert r.status_code == 201, r.text
    cls = next(c for c in r.json()["classes"] if c["class_id"] == CLASS_ID)
    return r.json()["id"], cls["exam_id"]


def test_teacher_cannot_edit_grade_linked_exam(client, settings, db):
    grade_exam_id, exam_id = _grade_linked_exam(client, settings, db)
    url = f"{EXAMS}/{exam_id}"
    r = client.put(
        url,
        json={
            "name": "我改的名字",
            "exam_type": "期中",
            "date": "2026-11-10",
            "subjects": [{"name": "语文", "full": 100}],
        },
        headers=auth(settings),
    )
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "EXAM_MANAGED_BY_GRADE" and err["message"] == "这是年级联考,由教导处修改"
    r = client.delete(url, headers=auth(settings))
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXAM_MANAGED_BY_GRADE"
    got = client.get(EXAMS, headers=auth(settings)).json()["items"]
    linked = next(e for e in got if e["id"] == exam_id)
    assert linked["name"] == "期中联考" and linked["grade_exam_id"] == grade_exam_id
    # 没有编辑权限的人仍先看到 403,而不是 409
    r = client.delete(url, headers=auth(settings, ASSISTANT_USER_ID))
    assert r.status_code == 403
    # 班级自己的考试不受影响
    r = client.put(f"{EXAMS}/{EXAM_IDS[0]}", json=_body(name="自己的考试"), headers=auth(settings))
    assert r.status_code == 200


def test_teacher_can_still_enter_scores(client, settings, db):
    _, exam_id = _grade_linked_exam(client, settings, db)
    enrollment = str(enrollment_of(db, STUDENT_IDS[0]))
    cells = [
        {"enrollment_id": enrollment, "subject": "语文", "value": 91.5},
        {"enrollment_id": enrollment, "subject": "数学", "value": 88.0},
    ]
    r = client.put(f"{EXAMS}/{exam_id}/scores", json={"cells": cells}, headers=auth(settings))
    assert r.status_code == 200 and r.json() == {"updated": 2}
    items = client.get(EXAMS, headers=auth(settings)).json()["items"]
    linked = next(e for e in items if e["id"] == exam_id)
    assert linked["progress"] == {"entered": 1, "total": 10}
