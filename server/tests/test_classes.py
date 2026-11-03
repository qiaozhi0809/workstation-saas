from uuid import UUID

from app.auth.tokens import issue_access_token
from app.rbac.roles import Role
from tests.factories import bind, make_class, make_user
from tests.seed_ids import CLASS_ID, TEACHER_USER_ID


def auth(settings, user_id):
    return {"Authorization": f"Bearer {issue_access_token(user_id, settings)[0]}"}


def test_my_classes_seed_teacher(client, settings):
    res = client.get("/api/v1/me/classes", headers=auth(settings, UUID(TEACHER_USER_ID)))
    assert res.status_code == 200
    assert res.json()["items"] == [
        {
            "id": CLASS_ID,
            "name": "三年二班",
            "grade_name": "三年级",
            "seat_rows": 6,
            "seat_cols": 4,
            "role": "homeroom_teacher",
            "desk_size": 2,
            "seat_layout": "manual",
            "seat_order": "row",
            "podium_left": 0,
            "podium_right": 0,
            "room": "求知楼 201",
        }
    ]


def test_my_classes_multi_binding(client, db, settings):
    u = make_user(db, "t_multi")
    other = make_class(db, "三年三班")
    bind(db, u.id, Role.homeroom_teacher, class_id=UUID(CLASS_ID))
    bind(db, u.id, Role.subject_teacher, class_id=other)
    items = client.get("/api/v1/me/classes", headers=auth(settings, u.id)).json()["items"]
    # 码位序:"三"(U+4E09) < "二"(U+4E8C),所以三年三班排在三年二班前
    assert [(i["name"], i["role"]) for i in items] == [
        ("三年三班", "subject_teacher"),
        ("三年二班", "homeroom_teacher"),
    ]


def test_same_class_two_roles_collapses_to_highest(client, db, settings):
    u = make_user(db, "t_same")
    bind(db, u.id, Role.subject_teacher, class_id=UUID(CLASS_ID))
    bind(db, u.id, Role.homeroom_teacher, class_id=UUID(CLASS_ID))
    items = client.get("/api/v1/me/classes", headers=auth(settings, u.id)).json()["items"]
    assert [i["role"] for i in items] == ["homeroom_teacher"]


def test_non_teacher_roles_are_ignored(client, db, settings):
    u = make_user(db, "t_parent")
    bind(db, u.id, Role.primary_parent, student_id=UUID("a0000001-0000-0000-0000-000000000001"))
    assert client.get("/api/v1/me/classes", headers=auth(settings, u.id)).json()["items"] == []
