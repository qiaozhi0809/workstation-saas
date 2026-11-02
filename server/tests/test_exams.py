from uuid import UUID

import pytest
from sqlalchemy import select

from app.domain.exams.subjects import stage_of
from app.models import Score
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
