from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import Score
from app.rbac.roles import Role
from tests.factories import bind, make_class, make_student, make_user
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import CLASS_ID, EXAM_IDS, SCHOOL_ID, STUDENT_IDS, SUBJECT_USER_ID

BASE = f"/api/v1/classes/{CLASS_ID}"
EXAMS = f"{BASE}/exams"


def _chinese_exam(client, settings, user=None):
    body = {
        "name": "语文小测",
        "exam_type": "周测",
        "date": "2026-11-02",
        "subjects": [{"name": "语文", "full": 100}],
    }
    headers = auth(settings, user) if user else auth(settings)
    r = client.post(EXAMS, json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _cell(db, idx, subject, value):
    return {
        "enrollment_id": str(enrollment_of(db, STUDENT_IDS[idx])),
        "subject": subject,
        "value": value,
    }


def _put(client, settings, exam_id, cells, user=None):
    headers = auth(settings, user) if user else auth(settings)
    return client.put(f"{EXAMS}/{exam_id}/scores", json={"cells": cells}, headers=headers)


def _sheet(client, settings, exam_id, user=None):
    headers = auth(settings, user) if user else auth(settings)
    r = client.get(f"{EXAMS}/{exam_id}/scores", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _rows(db, exam_id):
    db.expire_all()
    return list(db.scalars(select(Score).where(Score.exam_id == UUID(exam_id))).all())


def test_sheet_lists_every_active_student(client, settings, db):
    sheet = _sheet(client, settings, EXAM_IDS[1])
    assert len(sheet["items"]) == 10
    eid = str(enrollment_of(db, STUDENT_IDS[4]))
    fifth = next(i for i in sheet["items"] if i["enrollment_id"] == eid)
    assert fifth["scores"] == {"语文": 62, "数学": 55, "英语": None}
    assert sheet["exam"]["id"] == EXAM_IDS[1]


def test_save_scores_set_absent_and_clear(client, settings, db):
    exam_id = _chinese_exam(client, settings)
    r = _put(
        client,
        settings,
        exam_id,
        [_cell(db, 0, "语文", 88.5), _cell(db, 1, "语文", "absent"), _cell(db, 2, "语文", 70)],
    )
    assert r.status_code == 200 and r.json() == {"updated": 3}
    r = _put(client, settings, exam_id, [_cell(db, 2, "语文", None)])
    assert r.json() == {"updated": 1}
    by_eid = {i["enrollment_id"]: i["scores"] for i in _sheet(client, settings, exam_id)["items"]}
    assert by_eid[str(enrollment_of(db, STUDENT_IDS[0]))] == {"语文": 88.5}
    assert by_eid[str(enrollment_of(db, STUDENT_IDS[1]))] == {"语文": None}
    assert by_eid[str(enrollment_of(db, STUDENT_IDS[2]))] == {}
    writes = [a for a in audit_rows(db, exam_id) if a.action == "score.write"]
    assert [(a.success, a.object_type, a.extra) for a in writes] == [
        (True, "exam", {"cells": 3}),
        (True, "exam", {"cells": 1}),
    ]


def test_save_dedupes_last_wins_and_overwrites(client, settings, db):
    exam_id = _chinese_exam(client, settings)
    r = _put(client, settings, exam_id, [_cell(db, 0, "语文", 10), _cell(db, 0, "语文", 20)])
    assert r.json() == {"updated": 1}
    assert [s.value for s in _rows(db, exam_id)] == [20]
    _put(client, settings, exam_id, [_cell(db, 0, "语文", "absent")])
    assert [s.value for s in _rows(db, exam_id)] == [None]
    _put(client, settings, exam_id, [_cell(db, 0, "语文", 30.5)])
    assert [s.value for s in _rows(db, exam_id)] == [30.5]


def test_empty_or_oversized_cells_rejected(client, settings, db):
    exam_id = _chinese_exam(client, settings)
    assert _put(client, settings, exam_id, []).status_code == 400
    many = [_cell(db, 0, "语文", 1)] * 2001
    r = _put(client, settings, exam_id, many)
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"


def test_score_validation_is_atomic(client, settings, db):
    exam_id = _chinese_exam(client, settings)
    good = _cell(db, 1, "语文", 80)
    bad = _cell(db, 0, "语文", 101)
    r = _put(client, settings, exam_id, [good, bad])
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "SCORE_INVALID"
    assert err["details"] == {"enrollment_id": bad["enrollment_id"], "subject": "语文"}
    assert _rows(db, exam_id) == []
    for value in (88.25, -1):
        r = _put(client, settings, exam_id, [good, _cell(db, 0, "语文", value)])
        assert r.status_code == 400 and r.json()["error"]["code"] == "SCORE_INVALID"
    r = _put(client, settings, exam_id, [good, _cell(db, 0, "数学", 5)])
    err = r.json()["error"]
    assert r.status_code == 400 and err["code"] == "UNKNOWN_SUBJECT"
    assert err["details"] == {"subject": "数学"}
    other = make_class(db, "二班")
    stranger = make_student(db, other, "外班生", "SX0001")
    foreign = {
        "enrollment_id": str(enrollment_of(db, stranger)),
        "subject": "语文",
        "value": 5,
    }
    r = _put(client, settings, exam_id, [good, foreign])
    assert r.status_code == 400 and r.json()["error"]["code"] == "UNKNOWN_ENROLLMENT"
    assert _rows(db, exam_id) == []


def test_subject_teacher_cannot_write_other_subject_atomically(client, settings, db):
    cells = [_cell(db, 0, "数学", 60), _cell(db, 0, "语文", 60)]
    before = {(s.subject, s.value) for s in _rows(db, EXAM_IDS[1])}
    r = _put(client, settings, EXAM_IDS[1], cells, SUBJECT_USER_ID)
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "SUBJECT_NOT_ALLOWED" and err["details"] == {"subject": "语文"}
    assert {(s.subject, s.value) for s in _rows(db, EXAM_IDS[1])} == before
    sheet = _sheet(client, settings, EXAM_IDS[1], SUBJECT_USER_ID)
    first = next(
        i for i in sheet["items"] if i["enrollment_id"] == str(enrollment_of(db, STUDENT_IDS[0]))
    )
    assert first["scores"] == {"数学": 95}


def test_subject_teacher_can_write_own_subject(client, settings, db):
    r = _put(client, settings, EXAM_IDS[1], [_cell(db, 0, "数学", 61)], SUBJECT_USER_ID)
    assert r.status_code == 200 and r.json() == {"updated": 1}


def test_subject_teacher_sees_only_own_subject_everywhere(client, settings, db):
    sheet = _sheet(client, settings, EXAM_IDS[1], SUBJECT_USER_ID)
    assert sheet["exam"]["subjects"] == [{"name": "数学", "full": 100}]
    assert len(sheet["items"]) == 10
    assert all(set(i["scores"]) == {"数学"} for i in sheet["items"])
    r = client.get(f"{BASE}/gradebook", headers=auth(settings, SUBJECT_USER_ID))
    exams = r.json()["exams"]
    assert [e["id"] for e in exams] == EXAM_IDS
    for e in exams:
        assert e["subjects"] == [{"name": "数学", "full": 100}]
        assert all(set(s) == {"数学"} for s in e["scores"].values())
        assert len(e["scores"]) == 10
    # 只含英语的考试:任课老师(数学)看不到
    english = client.post(
        EXAMS,
        json={
            "name": "英语测",
            "exam_type": "周测",
            "date": "2026-11-02",
            "subjects": [{"name": "英语", "full": 100}],
        },
        headers=auth(settings),
    ).json()["id"]
    r = client.get(f"{EXAMS}/{english}/scores", headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    r = _put(client, settings, english, [_cell(db, 0, "英语", 5)], SUBJECT_USER_ID)
    assert r.status_code == 404
    gb = client.get(f"{BASE}/gradebook", headers=auth(settings, SUBJECT_USER_ID)).json()["exams"]
    assert english not in [e["id"] for e in gb]


def test_subject_teacher_progress_counts_only_visible_subjects(client, settings, db):
    body = {
        "name": "双科",
        "exam_type": "周测",
        "date": "2026-11-02",
        "subjects": [{"name": "数学", "full": 100}, {"name": "英语", "full": 100}],
    }
    exam_id = client.post(EXAMS, json=body, headers=auth(settings)).json()["id"]
    _put(client, settings, exam_id, [_cell(db, 0, "英语", 50)])
    sheet = _sheet(client, settings, exam_id, SUBJECT_USER_ID)
    assert sheet["exam"]["progress"] == {"entered": 0, "total": 10}
    assert all(i["scores"] == {} for i in sheet["items"])
    full = _sheet(client, settings, exam_id)
    assert full["exam"]["progress"] == {"entered": 0, "total": 10}
    _put(client, settings, exam_id, [_cell(db, 0, "数学", 50)])
    assert _sheet(client, settings, exam_id, SUBJECT_USER_ID)["exam"]["progress"]["entered"] == 1


def test_subject_teacher_export_denied(client, settings, db):
    r = client.get(f"{EXAMS}/{EXAM_IDS[1]}/export", headers=auth(settings, SUBJECT_USER_ID))
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "score.export"]
    assert [a.success for a in rows] == [False]


def test_export_has_all_subjects_and_audits(client, settings, db):
    r = client.get(f"{EXAMS}/{EXAM_IDS[1]}/export", headers=auth(settings))
    assert r.status_code == 200
    body = r.json()
    assert [s["name"] for s in body["exam"]["subjects"]] == ["语文", "数学", "英语"]
    assert len(body["items"]) == 10 and all(len(i["scores"]) == 3 for i in body["items"])
    rows = audit_rows(db, EXAM_IDS[1])
    assert [(a.action, a.success, a.object_type) for a in rows] == [("score.export", True, "exam")]


def test_export_unknown_exam_is_404(client, settings):
    r = client.get(f"{EXAMS}/{'0' * 8}-0000-0000-0000-{'0' * 12}/export", headers=auth(settings))
    assert r.status_code == 404


def test_gradebook_oldest_first(client, settings, db):
    exams = client.get(f"{BASE}/gradebook", headers=auth(settings)).json()["exams"]
    assert [e["id"] for e in exams] == EXAM_IDS
    eid = str(enrollment_of(db, STUDENT_IDS[0]))
    assert isinstance(exams[0]["scores"][eid]["语文"], (int, float))
    assert exams[0]["progress"] == {"entered": 10, "total": 10}


def test_removed_student_disappears_from_sheet_and_gradebook(client, settings, db):
    from app.models import Enrollment

    eid = enrollment_of(db, STUDENT_IDS[9])
    db.get(Enrollment, eid).status = "removed"
    db.flush()
    assert len(_sheet(client, settings, EXAM_IDS[0])["items"]) == 9
    exams = client.get(f"{BASE}/gradebook", headers=auth(settings)).json()["exams"]
    assert all(str(eid) not in e["scores"] for e in exams)
    r = _put(
        client, settings, EXAM_IDS[0], [{"enrollment_id": str(eid), "subject": "语文", "value": 1}]
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "UNKNOWN_ENROLLMENT"


def test_principal_reads_gradebook(client, settings, db):
    user = make_user(db, "principal1")
    bind(db, user.id, Role.principal, school_id=SCHOOL_ID)
    r = client.get(f"{BASE}/gradebook", headers=auth(settings, user.id))
    assert r.status_code == 200
    exams = r.json()["exams"]
    assert [s["name"] for s in exams[0]["subjects"]] == ["语文", "数学", "英语"]
    r = client.get(f"{EXAMS}/{EXAM_IDS[0]}/export", headers=auth(settings, user.id))
    assert r.status_code == 200
    r = _put(client, settings, EXAM_IDS[0], [_cell(db, 0, "语文", 1)], user.id)
    assert r.status_code == 403


@pytest.mark.parametrize("path", ["gradebook", f"exams/{EXAM_IDS[0]}/scores"])
def test_assistant_cannot_read(client, settings, path):
    from tests.seed_ids import ASSISTANT_USER_ID

    r = client.get(f"{BASE}/{path}", headers=auth(settings, ASSISTANT_USER_ID))
    assert r.status_code == 403
