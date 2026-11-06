import json
from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.models import RoleBinding, User
from app.models.audit import AuditLog
from app.models.parents import Parent, ParentLink
from tests.factories import make_user
from tests.helpers import auth
from tests.seed_ids import STUDENT_IDS, SUBJECT_USER_ID

S3, S4 = STUDENT_IDS[2], STUDENT_IDS[3]
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
TEACHER04 = "55555555-5555-5555-5555-555555555541"


def _url(sid: str) -> str:
    return f"/api/v1/students/{sid}/parents"


def _add(client, settings, sid, phone, name="虚构家长", relation="母亲", user=None):
    headers = auth(settings) if user is None else auth(settings, user)
    return client.post(
        _url(sid), headers=headers, json={"phone": phone, "name": name, "relation": relation}
    )


def _login(client, name, pw="dev123"):
    return client.post("/api/v1/auth/login", json={"login_name": name, "password": pw})


def _user(db, login) -> User:
    return db.scalar(select(User).where(User.login_name == login))


def _roles(db, login) -> list[str]:
    uid = _user(db, login).id
    return list(
        db.scalars(
            select(RoleBinding.role_type)
            .where(RoleBinding.user_id == uid, RoleBinding.ended_at.is_(None))
            .order_by(RoleBinding.created_at)
        )
    )


def _audits(db, action):
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action)).all())


def _user_count(db) -> int:
    return db.scalar(select(func.count()).select_from(User))


def test_create_new_parent_account(client, settings, db):
    res = _add(client, settings, S3, "13800000071", "陈家长", "父亲")
    assert res.status_code == 201, res.text
    body = res.json()
    temp = body["temp_password"]
    assert temp
    p = body["parent"]
    assert p["name"] == "陈家长" and p["relation"] == "父亲" and p["phone"] == "13800000071"
    assert p["is_primary"] is True and p["status"] == "active"
    assert p["account_status"] == "active" and p["shared_account"] is False
    assert p["must_change_password"] is True
    user = _user(db, "13800000071")
    assert user.phone == "13800000071" and user.must_change_password is True
    assert _roles(db, "13800000071") == ["primary_parent"]
    assert [a.action for a in _audits(db, "parent.create")] == ["parent.create"]
    assert temp not in str(_audits(db, "parent.create")[0].extra)

    login = _login(client, "13800000071", temp)
    assert login.status_code == 200
    assert login.json()["user"]["must_change_password"] is True
    tokens = login.json()
    res = client.post(
        "/api/v1/auth/password",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        json={
            "old_password": temp,
            "new_password": "Newpass123",
            "refresh_token": tokens["refresh_token"],
        },
    )
    assert res.status_code == 200
    me = client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert me.json()["contexts"] == ["parent"]


def test_existing_teacher_phone_links_without_password(client, settings, db):
    before = _user_count(db)
    res = _add(client, settings, S3, "13800000004", "孙老师", "父亲")
    assert res.status_code == 201, res.text
    assert res.json()["temp_password"] is None
    assert res.json()["parent"]["shared_account"] is True
    assert res.json()["parent"]["user_id"] == TEACHER04
    assert _user_count(db) == before
    assert _login(client, "teacher04").status_code == 200
    assert len(_audits(db, "parent.link")) == 1 and not _audits(db, "parent.create")
    assert "primary_parent" in _roles(db, "teacher04")


def test_same_parent_second_child(client, settings, db):
    first = _add(client, settings, S3, "13800000072").json()
    before = _user_count(db)
    second = _add(client, settings, S4, "13800000072")
    assert second.status_code == 201
    assert second.json()["temp_password"] is None
    assert second.json()["parent"]["user_id"] == first["parent"]["user_id"]
    assert second.json()["parent"]["link_id"] != first["parent"]["link_id"]
    assert _user_count(db) == before
    assert (
        db.scalar(select(func.count()).select_from(Parent).where(Parent.phone == "13800000072"))
        == 1
    )
    # 同一孩子重复绑定
    dup = _add(client, settings, S3, "13800000072")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "PARENT_EXISTS"


def test_parent_limit(client, settings, db):
    links = []
    for n in range(4):
        res = _add(client, settings, S3, f"1380000008{n}")
        assert res.status_code == 201
        links.append(res.json()["parent"]["link_id"])
    res = _add(client, settings, S3, "13800000089")
    assert res.status_code == 409 and res.json()["error"]["code"] == "PARENT_LIMIT"
    assert _user(db, "13800000089") is None
    assert (
        client.delete(f"/api/v1/parent-links/{links[3]}", headers=auth(settings)).status_code == 204
    )
    assert _add(client, settings, S3, "13800000089").status_code == 201


def test_first_is_primary_and_swap(client, settings, db):
    a = _add(client, settings, S3, "13800000073").json()["parent"]
    b = _add(client, settings, S3, "13800000074").json()["parent"]
    assert a["is_primary"] is True and b["is_primary"] is False
    assert _roles(db, "13800000073") == ["primary_parent"]
    assert _roles(db, "13800000074") == ["secondary_parent"]
    res = client.post(f"/api/v1/parent-links/{b['link_id']}/primary", headers=auth(settings))
    assert res.status_code == 200, res.text
    items = res.json()
    assert [i["link_id"] for i in items] == [b["link_id"], a["link_id"]]
    assert [i["is_primary"] for i in items] == [True, False]
    assert _roles(db, "13800000073") == ["secondary_parent"]
    assert _roles(db, "13800000074") == ["primary_parent"]
    primaries = db.scalar(
        select(func.count())
        .select_from(ParentLink)
        .where(ParentLink.student_id == UUID(S3), ParentLink.is_primary)
    )
    assert primaries == 1
    assert len(_audits(db, "parent.primary")) == 1
    listed = client.get(_url(S3), headers=auth(settings)).json()
    assert [i["link_id"] for i in listed] == [b["link_id"], a["link_id"]]


def test_unlink_archives_lonely_account(client, settings, db):
    created = _add(client, settings, S3, "13800000075").json()
    a = created["parent"]
    b = _add(client, settings, S3, "13800000076").json()["parent"]
    c = _add(client, settings, S3, "13800000077").json()["parent"]
    # 测试共用一个事务,now() 恒等;手动拉开绑定时间
    for n, link in enumerate((b, c), start=1):
        db.execute(
            ParentLink.__table__.update()
            .where(ParentLink.id == UUID(link["link_id"]))
            .values(created_at=datetime(2026, 11, n, tzinfo=UTC))
        )
    tokens = _login(client, "13800000075", created["temp_password"]).json()
    res = client.delete(f"/api/v1/parent-links/{a['link_id']}", headers=auth(settings))
    assert res.status_code == 204
    assert _user(db, "13800000075").status == "archived"
    assert _login(client, "13800000075").status_code == 401
    refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401
    assert _roles(db, "13800000075") == []
    # 最早的次要家长升为主家长
    listed = client.get(_url(S3), headers=auth(settings)).json()
    assert [(i["link_id"], i["is_primary"]) for i in listed] == [
        (b["link_id"], True),
        (c["link_id"], False),
    ]
    assert _roles(db, "13800000076") == ["primary_parent"]
    assert _roles(db, "13800000077") == ["secondary_parent"]
    assert len(_audits(db, "parent.unlink")) == 1
    # 解绑已结束的绑定
    gone = client.delete(f"/api/v1/parent-links/{a['link_id']}", headers=auth(settings))
    assert gone.status_code == 404


def test_unlink_keeps_account_with_other_child_and_teacher(client, settings, db):
    a = _add(client, settings, S3, "13800000078").json()["parent"]
    _add(client, settings, S4, "13800000078")
    t = _add(client, settings, S3, "13800000004").json()["parent"]
    assert (
        client.delete(f"/api/v1/parent-links/{a['link_id']}", headers=auth(settings)).status_code
        == 204
    )
    assert _user(db, "13800000078").status == "active"
    assert (
        client.delete(f"/api/v1/parent-links/{t['link_id']}", headers=auth(settings)).status_code
        == 204
    )
    # 教职工账号即使没有家长绑定了也不归档
    assert _user(db, "teacher04").status == "active"


def _stagger(db, *links):
    # 测试共用一个事务,now() 恒等;手动拉开绑定时间,先传的更早
    for n, link in enumerate(links, start=1):
        db.execute(
            ParentLink.__table__.update()
            .where(ParentLink.id == UUID(link["link_id"]))
            .values(created_at=datetime(2026, 11, n, tzinfo=UTC))
        )


def _make_readonly(db, link):
    db.execute(
        ParentLink.__table__.update()
        .where(ParentLink.id == UUID(link["link_id"]))
        .values(status="readonly", readonly_since=datetime(2026, 11, 1, tzinfo=UTC))
    )


def test_unlink_heir_skips_readonly(client, settings, db):
    p1 = _add(client, settings, S3, "13800000081").json()["parent"]
    p2 = _add(client, settings, S3, "13800000082").json()["parent"]
    p3 = _add(client, settings, S3, "13800000083").json()["parent"]
    _stagger(db, p1, p2, p3)
    _make_readonly(db, p2)  # P2 更早但只读,不能继任
    res = client.delete(f"/api/v1/parent-links/{p1['link_id']}", headers=auth(settings))
    assert res.status_code == 204
    rows = {
        r.id: r
        for r in db.scalars(
            select(ParentLink)
            .where(ParentLink.student_id == UUID(S3))
            .execution_options(populate_existing=True)
        )
    }
    assert rows[UUID(p3["link_id"])].is_primary is True
    assert rows[UUID(p2["link_id"])].is_primary is False
    assert rows[UUID(p2["link_id"])].status == "readonly"
    assert _roles(db, "13800000083") == ["primary_parent"]
    assert _roles(db, "13800000082") == ["secondary_parent"]


def test_unlink_no_active_heir_leaves_no_primary(client, settings, db):
    p1 = _add(client, settings, S3, "13800000084").json()["parent"]
    p2 = _add(client, settings, S3, "13800000085").json()["parent"]
    _stagger(db, p1, p2)
    _make_readonly(db, p2)
    res = client.delete(f"/api/v1/parent-links/{p1['link_id']}", headers=auth(settings))
    assert res.status_code == 204
    primaries = db.scalar(
        select(func.count())
        .select_from(ParentLink)
        .where(
            ParentLink.student_id == UUID(S3),
            ParentLink.is_primary,
            ParentLink.status != "ended",
        )
    )
    assert primaries == 0
    assert _roles(db, "13800000085") == ["secondary_parent"]


def _drain(pubsub) -> list[dict]:
    out = []
    while (msg := pubsub.get_message(timeout=0.5)) is not None:
        if msg["type"] == "message":
            out.append(json.loads(msg["data"]))
    return out


def test_unlink_archive_publishes_revoked(client, settings, db, redis_client):
    lonely = _add(client, settings, S3, "13800000086").json()["parent"]
    busy = _add(client, settings, S3, "13800000087").json()["parent"]
    _add(client, settings, S4, "13800000087")
    pubsub = redis_client.pubsub()
    pubsub.subscribe("ws:events")
    assert pubsub.get_message(timeout=2)["type"] == "subscribe"
    # 还有别的孩子:账号不归档,不发布
    res = client.delete(f"/api/v1/parent-links/{busy['link_id']}", headers=auth(settings))
    assert res.status_code == 204
    assert _user(db, "13800000087").status == "active"
    assert _drain(pubsub) == []
    # 只有这一个孩子:账号归档,提交后发布一次,user_ids 恰好是他
    res = client.delete(f"/api/v1/parent-links/{lonely['link_id']}", headers=auth(settings))
    assert res.status_code == 204
    uid = str(_user(db, "13800000086").id)
    assert _drain(pubsub) == [{"user_ids": [uid], "event": {"type": "session.revoked"}}]
    pubsub.close()


def test_relink_ended_restores_row(client, settings, db):
    a = _add(client, settings, S3, "13800000079", relation="祖辈").json()["parent"]
    _add(client, settings, S4, "13800000079")
    assert (
        client.delete(f"/api/v1/parent-links/{a['link_id']}", headers=auth(settings)).status_code
        == 204
    )
    assert client.get(_url(S3), headers=auth(settings)).json() == []
    res = _add(client, settings, S3, "13800000079", relation="其他")
    assert res.status_code == 201, res.text
    assert res.json()["temp_password"] is None
    assert res.json()["parent"]["link_id"] == a["link_id"]
    assert res.json()["parent"]["is_primary"] is True
    assert res.json()["parent"]["relation"] == "其他"
    assert _roles(db, "13800000079").count("primary_parent") == 2


def test_relink_ended_respects_limit(client, settings, db):
    a = _add(client, settings, S3, "13800000079").json()["parent"]
    _add(client, settings, S4, "13800000079")
    client.delete(f"/api/v1/parent-links/{a['link_id']}", headers=auth(settings))
    for n in range(4):
        assert _add(client, settings, S3, f"1380000009{n}").status_code == 201
    res = _add(client, settings, S3, "13800000079")
    assert res.status_code == 409 and res.json()["error"]["code"] == "PARENT_LIMIT"


def test_relink_readonly_returns_readable_409(client, settings, db):
    a = _add(client, settings, S3, "13800000079").json()["parent"]
    db.execute(
        ParentLink.__table__.update()
        .where(ParentLink.id == UUID(a["link_id"]))
        .values(status="readonly", readonly_since=datetime(2026, 11, 1, tzinfo=UTC))
    )
    res = _add(client, settings, S3, "13800000079")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "PARENT_EXISTS"
    assert res.json()["error"]["message"]


def test_reset_shared_account_rejected(client, settings, db):
    shared = _add(client, settings, S3, "13800000004").json()["parent"]
    before = _user(db, "teacher04").password_hash
    res = client.post(
        f"/api/v1/parent-links/{shared['link_id']}/reset-password", headers=auth(settings)
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "PARENT_ACCOUNT_SHARED"
    assert _user(db, "teacher04").password_hash == before
    assert _login(client, "teacher04").status_code == 200

    pure = _add(client, settings, S3, "13800000075").json()["parent"]
    res = client.post(
        f"/api/v1/parent-links/{pure['link_id']}/reset-password", headers=auth(settings)
    )
    assert res.status_code == 200, res.text
    temp = res.json()["temp_password"]
    assert temp
    assert _login(client, "13800000075", temp).status_code == 200
    assert _user(db, "13800000075").must_change_password is True
    audits = _audits(db, "parent.reset")
    assert len(audits) == 1
    assert temp not in str(audits[0].extra) and temp not in str(audits[0].object_id)


def test_reset_revokes_refresh_and_clears_lock(client, settings, db, redis_client):
    created = _add(client, settings, S3, "13800000076").json()
    link = created["parent"]["link_id"]
    tokens = _login(client, "13800000076", created["temp_password"]).json()
    for _ in range(settings.login_max_failures):
        _login(client, "13800000076", "wrong-password")
    assert _login(client, "13800000076", created["temp_password"]).status_code == 429
    res = client.post(f"/api/v1/parent-links/{link}/reset-password", headers=auth(settings))
    assert res.status_code == 200
    refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401
    assert _login(client, "13800000076", res.json()["temp_password"]).status_code == 200


def test_reset_inactive_account_rejected(client, settings, db):
    p = _add(client, settings, S3, "13800000077").json()["parent"]
    _user(db, "13800000077").status = "frozen"
    db.flush()
    res = client.post(f"/api/v1/parent-links/{p['link_id']}/reset-password", headers=auth(settings))
    assert res.status_code == 409 and res.json()["error"]["code"] == "ACCOUNT_NOT_ACTIVE"
    listed = client.get(_url(S3), headers=auth(settings)).json()
    assert listed[0]["account_status"] == "frozen"


def test_phone_invalid_and_ambiguous(client, settings, db):
    for bad in ("12345", "1380000007a", "138000000712"):
        res = _add(client, settings, S3, bad)
        assert res.status_code == 400 and res.json()["error"]["code"] == "PHONE_INVALID", bad
    make_user(db, "13800000081", "占登录名")
    other = make_user(db, "someone_else", "占手机号")
    other.phone = "13800000081"
    db.flush()
    res = _add(client, settings, S3, "13800000081")
    assert res.status_code == 409 and res.json()["error"]["code"] == "PHONE_AMBIGUOUS"
    # 停用账号占用登录名
    frozen = make_user(db, "13800000082", "停用的")
    frozen.status = "frozen"
    db.flush()
    res = _add(client, settings, S3, "13800000082")
    assert res.status_code == 409 and res.json()["error"]["code"] == "PHONE_TAKEN_INACTIVE"
    # 缺字段
    res = client.post(_url(S3), headers=auth(settings), json={"phone": "13800000083"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"
    res = client.post(_url(S3), headers=auth(settings))
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"
    res = _add(client, settings, S3, "13800000083", relation="邻居")
    assert res.status_code == 400


def test_shared_account_with_nonparent_binding(client, settings, db):
    p = _add(client, settings, S3, "13800000071").json()["parent"]
    assert p["shared_account"] is False
    db.add(RoleBinding(user_id=_user(db, "13800000071").id, role_type="it_admin", scope={}))
    db.flush()
    listed = client.get(_url(S3), headers=auth(settings)).json()
    assert [x["shared_account"] for x in listed] == [True]
    before = _user(db, "13800000071").password_hash
    res = client.post(f"/api/v1/parent-links/{p['link_id']}/reset-password", headers=auth(settings))
    assert res.status_code == 409 and res.json()["error"]["code"] == "PARENT_ACCOUNT_SHARED"
    assert _user(db, "13800000071").password_hash == before


def test_ended_nonparent_binding_not_shared(client, settings, db):
    _add(client, settings, S3, "13800000072")
    db.add(
        RoleBinding(
            user_id=_user(db, "13800000072").id,
            role_type="it_admin",
            scope={},
            ended_at=datetime.now(UTC),
        )
    )
    db.flush()
    listed = client.get(_url(S3), headers=auth(settings)).json()
    assert listed[0]["shared_account"] is False


@pytest.mark.parametrize("raw", ["138 0000 0073", "138-0000-0073", " 138 - 0000 0073 "])
def test_phone_normalized(client, settings, db, raw):
    res = _add(client, settings, S3, raw)
    assert res.status_code == 201, res.text
    assert res.json()["parent"]["phone"] == "13800000073"
    assert _user(db, "13800000073") is not None


@pytest.mark.parametrize("bad", ["00000000000", "02012345678", "1" * 200, "12800000073"])
def test_phone_rule_and_overlong_rejected(client, settings, db, bad):
    res = _add(client, settings, S3, bad)
    assert res.status_code == 400 and res.json()["error"]["code"] == "PHONE_INVALID", bad


@pytest.mark.parametrize("who", [SUBJECT_USER_ID, PRINCIPAL, TEACHER04])
def test_non_homeroom_forbidden(client, settings, db, who):
    res = _add(client, settings, S3, "13800000084", user=who)
    assert res.status_code == 403
    assert client.get(_url(S3), headers=auth(settings, who)).status_code == 403
    denied = [a for a in _audits(db, "parent.manage") if str(a.user_id) == who]
    assert len(denied) == 2 and all(a.success is False for a in denied)
    assert _user(db, "13800000084") is None
    link = _add(client, settings, S3, "13800000085").json()["parent"]["link_id"]
    for method, path in (
        ("post", f"/api/v1/parent-links/{link}/primary"),
        ("post", f"/api/v1/parent-links/{link}/reset-password"),
        ("delete", f"/api/v1/parent-links/{link}"),
    ):
        assert getattr(client, method)(path, headers=auth(settings, who)).status_code == 403


def test_student_without_active_enrollment_forbidden(client, settings, db):
    from app.models import Enrollment

    db.execute(
        Enrollment.__table__.update()
        .where(Enrollment.student_id == UUID(S3))
        .values(status="removed")
    )
    res = _add(client, settings, S3, "13800000086")
    assert res.status_code == 403
    assert len([a for a in _audits(db, "parent.manage") if not a.success]) == 1
    assert (
        client.get(_url("00000000-0000-0000-0000-000000000000"), headers=auth(settings)).status_code
        == 404
    )


def test_reset_rejected_when_parent_has_other_class_child(client, settings, db):
    from app.rbac.roles import Role
    from tests.factories import bind, make_class, make_student, make_teacher_account

    cls2 = make_class(db, "虚构二班")
    s_other = str(make_student(db, cls2, "虚构学生", "mk-c-other"))
    teacher2 = make_teacher_account(db)
    bind(db, teacher2.id, Role.homeroom_teacher, class_id=cls2)
    db.commit()
    t2 = str(teacher2.id)
    mine = _add(client, settings, S3, "13800000091").json()["parent"]
    r17 = _add(client, settings, s_other, "13800000091", user=t2)
    assert r17.status_code == 201, r17.text
    other = r17.json()["parent"]
    assert mine["user_id"] == other["user_id"]
    before = _user(db, "13800000091").password_hash
    for link, who in ((mine["link_id"], None), (other["link_id"], t2)):
        headers = auth(settings) if who is None else auth(settings, who)
        res = client.post(f"/api/v1/parent-links/{link}/reset-password", headers=headers)
        assert res.status_code == 409 and res.json()["error"]["code"] == "PARENT_OTHER_CLASS"
    assert _user(db, "13800000091").password_hash == before
    denied = [a for a in _audits(db, "parent.reset") if a.success is False]
    assert len(denied) == 2

    solo = _add(client, settings, S4, "13800000092").json()["parent"]
    res = client.post(
        f"/api/v1/parent-links/{solo['link_id']}/reset-password", headers=auth(settings)
    )
    assert res.status_code == 200


def test_orm_declares_partial_index(db):
    from sqlalchemy import text as sql
    from sqlalchemy.dialects import postgresql

    from app.models.base import Base

    table = Base.metadata.tables["parent_links"]
    idx = next((i for i in table.indexes if i.name == "parent_links_one_primary"), None)
    assert idx is not None and idx.unique
    assert [c.name for c in idx.columns] == ["student_id"]
    where = idx.dialect_options["postgresql"]["where"]
    declared = str(
        where.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )
    assert declared == "is_primary AND status <> 'ended'"
    live = db.scalar(
        sql("SELECT indexdef FROM pg_indexes WHERE indexname = 'parent_links_one_primary'")
    )
    assert "UNIQUE" in live and "(student_id)" in live
    assert "is_primary AND (status <> 'ended'" in live
