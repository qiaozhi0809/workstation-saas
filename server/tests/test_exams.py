from app.domain.exams.subjects import stage_of
from tests.helpers import audit_rows, auth
from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID


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
