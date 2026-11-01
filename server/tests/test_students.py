from uuid import UUID

from sqlalchemy import select, text

from app.auth.tokens import issue_access_token
from app.models.audit import AuditLog
from app.rbac.roles import Role
from tests.factories import bind, make_class, make_student, make_user
from tests.seed_ids import CLASS_ID, GRADE_ID, TEACHER_USER_ID

WANG = "a0000001-0000-0000-0000-000000000001"  # 王小一,family_structure='双亲家庭'
LI = "a0000002-0000-0000-0000-000000000002"  # 李小二,family_structure=NULL


def auth(settings, user_id=TEACHER_USER_ID):
    return {"Authorization": f"Bearer {issue_access_token(UUID(str(user_id)), settings)[0]}"}


def audit_rows(db, object_id):
    return db.scalars(select(AuditLog).where(AuditLog.object_id == str(object_id))).all()


def test_roster_own_class(client, settings):
    res = client.get(f"/api/v1/classes/{CLASS_ID}/students", headers=auth(settings))
    items = res.json()["items"]
    assert len(items) == 10
    assert (items[0]["name"], items[0]["seat_row"], items[0]["seat_col"]) == ("王小一", 1, 1)
    assert set(items[0]) == {
        "enrollment_id",
        "student_id",
        "name",
        "mk",
        "seat_row",
        "seat_col",
        "avatar_seed",
    }


def test_roster_other_class_forbidden_and_audited(client, db, settings):
    other = make_class(db, "三年三班")
    res = client.get(f"/api/v1/classes/{other}/students", headers=auth(settings))
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"
    rows = audit_rows(db, other)
    assert [(r.action, r.success) for r in rows] == [("student.list", False)]


def test_roster_unknown_class_404(client, settings):
    res = client.get(
        "/api/v1/classes/00000000-0000-0000-0000-000000000000/students",
        headers=auth(settings),
    )
    assert res.status_code == 404


def test_profile_homeroom_sees_family_and_is_audited(client, db, settings):
    body = client.get(f"/api/v1/students/{WANG}", headers=auth(settings)).json()
    assert body["family_structure"] == "双亲家庭"
    assert body["class_id"] == CLASS_ID
    assert [(r.action, r.success) for r in audit_rows(db, WANG)] == [("student.read_profile", True)]


def test_profile_omits_null_fields(client, settings):
    res = client.get(f"/api/v1/students/{LI}", headers=auth(settings))
    body = res.json()
    assert "family_structure" not in body
    assert "health_notes" not in body
    assert "tags" not in body
    assert "null" not in res.text


def test_profile_blank_string_is_omitted(client, db, settings):
    db.execute(text("UPDATE students SET learning_summary = '   ' WHERE id = :id"), {"id": LI})
    assert (
        "learning_summary"
        not in client.get(f"/api/v1/students/{LI}", headers=auth(settings)).json()
    )


def test_teacher_notes_only_own(client, db, settings):
    db.execute(
        text("UPDATE students SET teacher_notes = CAST(:n AS jsonb) WHERE id = :id"),
        {
            "id": WANG,
            "n": (
                f'{{"{TEACHER_USER_ID}": {{"text": "我的笔记"}}, '
                '"someone-else": {"text": "别人"}}'
            ),
        },
    )
    body = client.get(f"/api/v1/students/{WANG}", headers=auth(settings)).json()
    assert body["teacher_notes"] == {"text": "我的笔记"}


def test_subject_teacher_field_level(client, db, settings):
    u = make_user(db, "t_subject")
    bind(db, u.id, Role.subject_teacher, class_id=UUID(CLASS_ID))
    db.execute(text("UPDATE students SET personality = '开朗' WHERE id = :id"), {"id": WANG})
    body = client.get(f"/api/v1/students/{WANG}", headers=auth(settings, u.id)).json()
    assert "family_structure" not in body
    assert "teacher_notes" not in body
    assert body["personality"] == "开朗"


def test_profile_other_class_forbidden_and_audited(client, db, settings):
    other = make_class(db, "三年三班")
    sid = make_student(db, other, "外班生", "S9001", family_structure="单亲")
    res = client.get(f"/api/v1/students/{sid}", headers=auth(settings))
    assert res.status_code == 403
    assert [(r.action, r.success) for r in audit_rows(db, sid)] == [("student.read_profile", False)]


def test_profile_multi_binding(client, db, settings):
    u = make_user(db, "t_multi2")
    other = make_class(db, "三年三班")
    sid = make_student(db, other, "外班生", "S9002", family_structure="单亲")
    bind(db, u.id, Role.homeroom_teacher, class_id=UUID(CLASS_ID))
    bind(db, u.id, Role.subject_teacher, class_id=other)
    assert (
        client.get(f"/api/v1/students/{WANG}", headers=auth(settings, u.id)).json()[
            "family_structure"
        ]
        == "双亲家庭"
    )
    assert (
        "family_structure"
        not in client.get(f"/api/v1/students/{sid}", headers=auth(settings, u.id)).json()
    )


def test_grade_head_scope_fully_populated(client, db, settings):
    u = make_user(db, "gh_user")
    bind(db, u.id, Role.grade_head, grade_id=GRADE_ID)
    roster = client.get(f"/api/v1/classes/{CLASS_ID}/students", headers=auth(settings, u.id))
    assert roster.status_code == 200
    assert len(roster.json()["items"]) == 10
    res = client.get(f"/api/v1/students/{WANG}", headers=auth(settings, u.id))
    assert res.status_code == 200
    body = res.json()
    assert body["family_structure"] == "双亲家庭"
    assert "teacher_notes" not in body
