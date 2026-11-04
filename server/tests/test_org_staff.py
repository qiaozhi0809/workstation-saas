from uuid import UUID

from sqlalchemy import text

from app.models import RoleBinding, SchoolClass
from tests.factories import make_teacher_account, make_user
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, SUBJECT_USER_ID, TEACHER_USER_ID
from tests.test_seating import payload

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER04 = "55555555-5555-5555-5555-555555555541"
TEACHER04_TID = "66666666-6666-6666-6666-666666666641"
TEACHER05 = "55555555-5555-5555-5555-555555555542"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"
API = "/api/v1/admin"


def _staff(client, settings, user_id, identity, subject=None, class_id=CLASS_ID, actor=PRINCIPAL):
    body = {"user_id": user_id, "identity": identity, "subject": subject}
    return client.post(f"{API}/classes/{class_id}/staff", json=body, headers=auth(settings, actor))


def _my_classes(client, settings, user_id):
    return client.get("/api/v1/me/classes", headers=auth(settings, user_id)).json()["items"]


def _actions(db, object_id, action):
    return [r for r in audit_rows(db, object_id) if r.action == action]


def test_subject_requires_subject(client, settings):
    for bad in (None, "", "  ", "语" * 11):
        res = _staff(client, settings, TEACHER05, "subject", bad)
        assert res.status_code == 400, bad
        assert res.json()["error"]["code"] == "BAD_REQUEST"
    res = _staff(client, settings, TEACHER05, "homeroom", "语文")
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"


def test_staff_user_must_be_active_teacher(client, db, settings):
    res = _staff(client, settings, "00000000-0000-0000-0000-000000000001", "assistant")
    assert res.status_code == 400 and res.json()["error"]["details"]["field"] == "user_id"
    db.execute(text("UPDATE users SET status = 'frozen' WHERE id = :u"), {"u": TEACHER05})
    res = _staff(client, settings, TEACHER05, "assistant")
    assert res.status_code == 400 and res.json()["error"]["details"]["field"] == "user_id"


def test_add_subject_teacher_can_open_class(client, db, settings):
    assert _my_classes(client, settings, TEACHER05) == [
        c for c in _my_classes(client, settings, TEACHER05) if c["name"] == "四年一班"
    ]
    res = _staff(client, settings, TEACHER05, "subject", "语文")
    assert res.status_code == 200, res.text
    chinese = [s for s in res.json()["subjects"] if s["subject"] == "语文"][0]
    assert chinese["teachers"][0]["display_name"] == "郑老师"
    mine = {c["id"]: c for c in _my_classes(client, settings, TEACHER05)}
    assert mine[CLASS_ID]["role"] == "subject_teacher"
    summary = client.get(f"/api/v1/classes/{CLASS_ID}/classroom", headers=auth(settings, TEACHER05))
    assert summary.json()["my_subjects"] == ["语文"]
    assignment_id = chinese["teachers"][0]["assignment_id"]
    assert _actions(db, assignment_id, "org.staff_add")[0].success


def test_replace_homeroom_ends_old_binding(client, db, settings):
    res = _staff(client, settings, TEACHER04, "homeroom")
    assert res.status_code == 200, res.text
    assert res.json()["homeroom"]["display_name"] == "孙老师"
    assert CLASS_ID not in [c["id"] for c in _my_classes(client, settings, TEACHER_USER_ID)]
    assert CLASS_ID in [c["id"] for c in _my_classes(client, settings, TEACHER04)]
    old = client.put(
        f"/api/v1/classes/{CLASS_ID}/seating",
        json=payload(db, base=0),
        headers=auth(settings, TEACHER_USER_ID),
    )
    assert old.status_code == 403
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    db.refresh(cls)
    assert str(cls.homeroom_teacher_id) == TEACHER04_TID
    ended = db.execute(
        text(
            "SELECT ended_at FROM teacher_assignments"
            " WHERE class_id = :c AND teacher_id = '66666666-6666-6666-6666-666666666666'"
        ),
        {"c": CLASS_ID},
    ).scalar_one()
    assert ended is not None
    open_homerooms = db.execute(
        text(
            "SELECT count(*) FROM teacher_assignments"
            " WHERE class_id = :c AND identity = 'homeroom' AND ended_at IS NULL"
        ),
        {"c": CLASS_ID},
    ).scalar_one()
    assert open_homerooms == 1


def test_duplicate_staff_rejected(client, settings):
    assert _staff(client, settings, TEACHER05, "subject", "语文").status_code == 200
    dup = _staff(client, settings, TEACHER05, "subject", "语文")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ALREADY_ASSIGNED"
    assert _staff(client, settings, TEACHER05, "subject", "科学").status_code == 200
    again = _staff(client, settings, TEACHER_USER_ID, "homeroom")
    assert again.status_code == 409 and again.json()["error"]["code"] == "ALREADY_ASSIGNED"


def test_end_staff_revokes_access(client, db, settings):
    cls = client.get(f"{API}/classes/{CLASS_ID}", headers=auth(settings, PRINCIPAL)).json()
    math = [s for s in cls["subjects"] if s["subject"] == "数学"][0]["teachers"][0]
    assert CLASS_ID in [c["id"] for c in _my_classes(client, settings, SUBJECT_USER_ID)]
    res = client.delete(f"{API}/staff/{math['assignment_id']}", headers=auth(settings, PRINCIPAL))
    assert res.status_code == 204
    assert _my_classes(client, settings, SUBJECT_USER_ID) == []
    assert _actions(db, math["assignment_id"], "org.staff_end")[0].success
    again = client.delete(f"{API}/staff/{math['assignment_id']}", headers=auth(settings, PRINCIPAL))
    assert again.status_code == 404


def test_end_homeroom_clears_homeroom_teacher(client, db, settings):
    cls = client.get(f"{API}/classes/{CLASS_ID}", headers=auth(settings, PRINCIPAL)).json()
    aid = cls["homeroom"]["assignment_id"]
    assert client.delete(f"{API}/staff/{aid}", headers=auth(settings, PRINCIPAL)).status_code == 204
    row = db.get(SchoolClass, UUID(CLASS_ID))
    db.refresh(row)
    assert row.homeroom_teacher_id is None
    assert _my_classes(client, settings, TEACHER_USER_ID) == []


def test_staff_requires_org_manage(client, db, settings):
    res = _staff(client, settings, TEACHER05, "assistant", actor=GRADE_HEAD)
    assert res.status_code == 403
    assert [r.success for r in _actions(db, SCHOOL_ID, "org.manage")] == [False]


def test_grade_head_role_needs_grade(client, db, settings):
    h = auth(settings, PRINCIPAL)
    res = client.post(f"{API}/roles", json={"user_id": TEACHER04, "role": "grade_head"}, headers=h)
    assert res.status_code == 400
    res = client.post(
        f"{API}/roles",
        json={"user_id": TEACHER04, "role": "principal", "grade_id": GRADE4_ID},
        headers=h,
    )
    assert res.status_code == 400
    res = client.post(
        f"{API}/roles",
        json={"user_id": TEACHER04, "role": "grade_head", "grade_id": GRADE4_ID},
        headers=h,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["role"], body["grade_name"], body["display_name"]) == (
        "grade_head",
        "四年级",
        "孙老师",
    )
    assert _actions(db, body["binding_id"], "org.role_add")[0].success
    me = client.get("/api/v1/auth/me", headers=auth(settings, TEACHER04)).json()
    assert "notice.send" in me["admin_perms"]
    dup = client.post(
        f"{API}/roles",
        json={"user_id": TEACHER04, "role": "grade_head", "grade_id": GRADE4_ID},
        headers=h,
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ALREADY_ASSIGNED"
    listed = client.get(f"{API}/roles", headers=h).json()
    assert {(r["display_name"], r["role"]) for r in listed} >= {
        ("何校长", "principal"),
        ("冯主任", "dean"),
        ("韩组长", "grade_head"),
        ("蒋老师", "it_admin"),
        ("孙老师", "grade_head"),
    }
    bad_grade = client.post(
        f"{API}/roles",
        json={
            "user_id": TEACHER05,
            "role": "grade_head",
            "grade_id": "99999999-9999-9999-9999-999999999999",
        },
        headers=h,
    )
    assert bad_grade.status_code == 400


def test_dean_cannot_grant_principal(client, db, settings):
    h = auth(settings, DEAN)
    res = client.post(f"{API}/roles", json={"user_id": DEAN, "role": "principal"}, headers=h)
    assert res.status_code == 403
    denied = [r for r in _actions(db, SCHOOL_ID, "account.manage") if not r.success]
    assert len(denied) == 1
    res = client.post(f"{API}/roles", json={"user_id": DEAN, "role": "it_admin"}, headers=h)
    assert res.status_code == 403
    ok = client.post(
        f"{API}/roles",
        json={"user_id": TEACHER04, "role": "grade_head", "grade_id": GRADE_ID},
        headers=h,
    )
    assert ok.status_code == 201


def _binding_id(client, settings, name, role):
    roles = client.get(f"{API}/roles", headers=auth(settings, PRINCIPAL)).json()
    return [r["binding_id"] for r in roles if r["display_name"] == name and r["role"] == role][0]


def test_dean_cannot_end_principal_but_can_end_grade_head(client, settings):
    h = auth(settings, DEAN)
    principal = _binding_id(client, settings, "何校长", "principal")
    assert client.delete(f"{API}/roles/{principal}", headers=h).status_code == 403
    head = _binding_id(client, settings, "韩组长", "grade_head")
    assert client.delete(f"{API}/roles/{head}", headers=h).status_code == 204


def test_remove_last_account_admin_rejected(client, db, settings):
    h = auth(settings, PRINCIPAL)
    it_admin = _binding_id(client, settings, "蒋老师", "it_admin")
    principal = _binding_id(client, settings, "何校长", "principal")
    res = client.delete(f"{API}/roles/{it_admin}", headers=h)
    assert res.status_code == 204
    assert _actions(db, it_admin, "org.role_end")[0].success
    res = client.delete(f"{API}/roles/{principal}", headers=h)
    assert res.status_code == 409 and res.json()["error"]["code"] == "LAST_ADMIN"
    row = db.get(RoleBinding, UUID(principal))
    assert row.ended_at is None
    # 不持有 account.manage 的岗位不受限制
    dean = _binding_id(client, settings, "冯主任", "dean")
    assert client.delete(f"{API}/roles/{dean}", headers=h).status_code == 204
    assert client.delete(f"{API}/roles/{dean}", headers=h).status_code == 404


def test_frozen_account_admin_not_counted_as_last(client, db, settings):
    h = auth(settings, PRINCIPAL)
    it_admin = _binding_id(client, settings, "蒋老师", "it_admin")
    db.execute(text("UPDATE users SET status = 'frozen' WHERE id = :u"), {"u": IT_ADMIN})
    principal = _binding_id(client, settings, "何校长", "principal")
    res = client.delete(f"{API}/roles/{principal}", headers=h)
    assert res.status_code == 409 and res.json()["error"]["code"] == "LAST_ADMIN"
    assert client.delete(f"{API}/roles/{it_admin}", headers=h).status_code == 204


def _capture_sql(db):
    from sqlalchemy import event

    statements: list[str] = []

    def grab(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    conn = db.get_bind()
    event.listen(conn, "before_cursor_execute", grab)
    return statements, lambda: event.remove(conn, "before_cursor_execute", grab)


def test_end_role_takes_advisory_lock_for_account_roles(client, db, settings):
    h = auth(settings, PRINCIPAL)
    it_admin = _binding_id(client, settings, "蒋老师", "it_admin")
    dean = _binding_id(client, settings, "冯主任", "dean")
    statements, stop = _capture_sql(db)
    try:
        assert client.delete(f"{API}/roles/{dean}", headers=h).status_code == 204
        assert not any("pg_advisory_xact_lock" in s for s in statements)
        assert client.delete(f"{API}/roles/{it_admin}", headers=h).status_code == 204
    finally:
        stop()
    lock_at = [i for i, s in enumerate(statements) if "pg_advisory_xact_lock" in s]
    count_at = [i for i, s in enumerate(statements) if "count(distinct" in s.lower()]
    assert len(lock_at) == 1 and count_at and lock_at[0] < count_at[0]


def _people(client, settings, q=None, actor=DEAN):
    params = {} if q is None else {"q": q}
    return client.get(f"{API}/org/people", params=params, headers=auth(settings, actor))


def test_people_requires_org_manage(client, db, settings):
    assert _people(client, settings, actor=DEAN).status_code == 200
    assert _people(client, settings, actor=TEACHER_USER_ID).status_code == 403
    denied = [r for r in _actions(db, SCHOOL_ID, "org.manage") if not r.success]
    assert len(denied) == 1


def test_people_lists_active_teachers_only(client, db, settings):
    frozen = make_teacher_account(db, SCHOOL_ID, "frozen_t")
    frozen.display_name = "冻结老师"
    frozen.status = "frozen"
    no_row = make_user(db, "no_teacher_row", "无教师行")
    no_row.school_id = UUID(SCHOOL_ID)
    db.flush()
    rows = _people(client, settings).json()
    ids = {r["user_id"] for r in rows}
    assert TEACHER_USER_ID in ids and str(frozen.id) not in ids and str(no_row.id) not in ids
    for r in rows:
        assert set(r) == {"user_id", "name", "login_name", "subjects"}
        assert isinstance(r["subjects"], list)
    names = [r["name"] for r in rows]
    assert names == sorted(names)


def test_people_other_school_excluded(client, db, settings):
    sid = db.execute(text("INSERT INTO schools (name) VALUES ('别校') RETURNING id")).scalar_one()
    other = make_teacher_account(db, sid, "other_school_t")
    ids = {r["user_id"] for r in _people(client, settings).json()}
    assert str(other.id) not in ids


def test_people_query_and_subjects(client, db, settings):
    u = make_teacher_account(db, SCHOOL_ID, "zz_find_me")
    u.display_name = "查找甲"
    db.execute(text("UPDATE teachers SET subjects = '{语文,数学}' WHERE user_id = :u"), {"u": u.id})
    db.flush()
    rows = _people(client, settings, "查找").json()
    assert [r["user_id"] for r in rows] == [str(u.id)]
    assert rows[0]["subjects"] == ["语文", "数学"] and rows[0]["login_name"] == "zz_find_me"
    assert [r["user_id"] for r in _people(client, settings, "ZZ_FIND").json()] == [str(u.id)]
    assert _people(client, settings, "zz_nomatch_xx").json() == []


def test_people_query_escapes_like_wildcards(client, db, settings):
    a = make_teacher_account(db, SCHOOL_ID, "wild_a%b")
    make_teacher_account(db, SCHOOL_ID, "wild_axb")
    make_teacher_account(db, SCHOOL_ID, "under_c")
    make_teacher_account(db, SCHOOL_ID, "underXc")
    assert [r["user_id"] for r in _people(client, settings, "a%b").json()] == [str(a.id)]
    got = {r["login_name"] for r in _people(client, settings, "r_c").json()}
    assert got == {"under_c"}
    pct = _people(client, settings, "%").json()
    assert [r["user_id"] for r in pct] == [str(a.id)]


def test_people_max_20(client, db, settings):
    for i in range(25):
        make_teacher_account(db, SCHOOL_ID, f"bulk_{i:02d}")
    assert len(_people(client, settings).json()) == 20
    assert len(_people(client, settings, "bulk_").json()) == 20
