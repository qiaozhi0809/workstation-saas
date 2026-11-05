"""家长绑定生命周期:毕业 / 移出变只读、回滚恢复、满一年归档。使用种子里的虚构家长。"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text

from app.auth import sessions
from app.auth.service import user_brief
from app.domain.parents.lifecycle import archive_expired
from app.domain.years.plan import UpgradePlan
from app.domain.years.service import apply, rollback
from app.domain.years.suggest import suggest
from app.models import User
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, SCHOOL_ID

SCHOOL = UUID(SCHOOL_ID)
NOW = datetime(2027, 8, 20, tzinfo=UTC)
PARENT01 = "55555555-5555-5555-5555-555555555561"  # 13800000061,S0001 + S0017
PARENT02 = "55555555-5555-5555-5555-555555555562"  # S0001 次要
TEACHER04 = "55555555-5555-5555-5555-555555555541"  # 同时是 S0002 的主家长
SENTINEL = "dev123"


def _link(db, user_id, mk):
    return db.execute(
        text(
            "SELECT pl.status, pl.readonly_since, pl.ended_at FROM parent_links pl"
            " JOIN parents p ON p.id = pl.parent_id JOIN students s ON s.id = pl.student_id"
            " WHERE p.user_id = :u AND s.mk = :mk"
        ),
        {"u": user_id, "mk": mk},
    ).one()


def _graduate_four(db) -> UpgradePlan:
    plan = suggest(db, SCHOOL, "2027-2028", date(2027, 9, 1), date(2028, 7, 15))
    four = next(c for c in plan.classes if c.from_name == "四年一班")
    four.action = "graduate"
    four.to_grade_name = four.to_name = None
    four.homeroom_teacher_id = None
    return plan


def test_graduate_makes_links_readonly_and_rollback_restores(db):
    up = apply(db, SCHOOL, _graduate_four(db), now=NOW)
    s17 = _link(db, PARENT01, "S0017")
    assert s17.status == "readonly" and s17.readonly_since == NOW
    assert _link(db, PARENT01, "S0001").status == "active"
    assert len(up.summary["parent_links_readonly"]) == 1

    rollback(db, SCHOOL, now=NOW + timedelta(days=1), upgrade_id=up.id)
    s17 = _link(db, PARENT01, "S0017")
    assert s17.status == "active" and s17.readonly_since is None


def test_rollback_of_legacy_summary_without_key_skips_reopen(db):
    up = apply(db, SCHOOL, _graduate_four(db), now=NOW)
    summary = dict(up.summary)
    del summary["parent_links_readonly"]
    up.summary = summary
    db.flush()
    rollback(db, SCHOOL, now=NOW + timedelta(days=1))
    assert _link(db, PARENT01, "S0017").status == "readonly"


def test_remove_student_readonly(client, settings, db):
    eid = db.execute(
        text(
            "SELECT e.id FROM enrollments e JOIN students s ON s.id = e.student_id"
            " WHERE s.mk = 'S0002' AND e.status = 'active'"
        )
    ).scalar_one()
    res = client.delete(f"/api/v1/classes/{CLASS_ID}/students/{eid}", headers=auth(settings))
    assert res.status_code == 204, res.text
    assert _link(db, TEACHER04, "S0002").status == "readonly"
    teacher_roles = db.execute(
        text(
            "SELECT count(*) FROM role_bindings WHERE user_id = :u AND ended_at IS NULL"
            " AND role_type = 'homeroom_teacher'"
        ),
        {"u": TEACHER04},
    ).scalar_one()
    assert teacher_roles == 1
    brief = user_brief(db, db.get(User, UUID(TEACHER04)))
    assert "teacher" in brief.contexts


def _assert_links_follow_enrollment(db):
    """有 active 注册的学生,未结束的绑定都是 active;没有的都是 readonly。"""
    bad = db.execute(
        text(
            "SELECT s.mk, pl.status FROM parent_links pl JOIN students s ON s.id = pl.student_id"
            " WHERE pl.status <> 'ended' AND pl.status <> CASE WHEN EXISTS ("
            " SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active')"
            " THEN 'active' ELSE 'readonly' END"
        )
    ).all()
    assert bad == []


def test_links_follow_enrollment_invariant(client, settings, db):
    """L62:任何让学生重新获得 active 注册的新入口(转班、撤销移出)都必须同时恢复绑定。
    现有三条路径(移出、升级毕业、回滚)每一步之后,绑定状态都跟着注册状态走。"""
    _assert_links_follow_enrollment(db)
    # 路径一:移出学生
    eid = db.execute(
        text(
            "SELECT e.id FROM enrollments e JOIN students s ON s.id = e.student_id"
            " WHERE s.mk = 'S0002' AND e.status = 'active'"
        )
    ).scalar_one()
    res = client.delete(f"/api/v1/classes/{CLASS_ID}/students/{eid}", headers=auth(settings))
    assert res.status_code == 204, res.text
    assert _link(db, TEACHER04, "S0002").status == "readonly"
    _assert_links_follow_enrollment(db)
    # 路径二:升级毕业
    up = apply(db, SCHOOL, _graduate_four(db), now=NOW)
    assert _link(db, PARENT01, "S0017").status == "readonly"
    _assert_links_follow_enrollment(db)
    # 路径三:回滚(只恢复升级里关掉的绑定,先前移出的 S0002 仍只读)
    rollback(db, SCHOOL, now=NOW + timedelta(days=1), upgrade_id=up.id)
    assert _link(db, PARENT01, "S0017").status == "active"
    assert _link(db, TEACHER04, "S0002").status == "readonly"
    _assert_links_follow_enrollment(db)


def _age(db, user_id, mk, days=366):
    db.execute(
        text(
            "UPDATE parent_links SET status = 'readonly', readonly_since = :t"
            " WHERE id = (SELECT pl.id FROM parent_links pl JOIN parents p ON p.id = pl.parent_id"
            " JOIN students s ON s.id = pl.student_id WHERE p.user_id = :u AND s.mk = :mk)"
        ),
        {"t": NOW - timedelta(days=days), "u": user_id, "mk": mk},
    )


def test_archive_idempotent(client, db, redis_client):
    _age(db, PARENT01, "S0017")
    first = archive_expired(db, SCHOOL, NOW, redis_client)
    assert (first.links, first.users) == (1, 0)
    assert _link(db, PARENT01, "S0017").status == "ended"
    second = archive_expired(db, SCHOOL, NOW, redis_client)
    assert (second.links, second.users) == (0, 0)
    ended = db.execute(
        text("SELECT count(*) FROM role_bindings WHERE user_id = :u AND ended_at IS NOT NULL"),
        {"u": PARENT01},
    ).scalar_one()
    assert ended == 1


def test_archive_last_child_archives_account(client, settings, db, redis_client):
    token = sessions.issue_refresh(redis_client, settings, UUID(PARENT02))
    assert redis_client.get(sessions.refresh_key(token)) is not None
    _age(db, PARENT02, "S0001")
    res = archive_expired(db, SCHOOL, NOW, redis_client)
    assert (res.links, res.users) == (1, 1)
    status = db.execute(
        text("SELECT status FROM users WHERE id = :u"), {"u": PARENT02}
    ).scalar_one()
    assert status == "archived"
    assert redis_client.get(sessions.refresh_key(token)) is None
    row = db.execute(
        text("SELECT user_id, object_id FROM audit_logs WHERE action = 'parent.archive'")
    ).one()
    assert row.user_id is None and row.object_id == PARENT02
    login = client.post(
        "/api/v1/auth/login", json={"login_name": "13800000062", "password": SENTINEL}
    )
    assert login.status_code == 401
    again = archive_expired(db, SCHOOL, NOW, redis_client)
    assert (again.links, again.users) == (0, 0)


@pytest.mark.parametrize("days,archived", [(364, 0), (365, 1), (366, 1)])
def test_archive_boundary(db, days, archived):
    _age(db, PARENT01, "S0017", days)
    res = archive_expired(db, SCHOOL, NOW)
    assert (res.links, res.users) == (archived, 0)
    assert _link(db, PARENT01, "S0017").status == ("ended" if archived else "readonly")


def test_archive_teacher_parent_keeps_account(db):
    _age(db, TEACHER04, "S0002")
    res = archive_expired(db, SCHOOL, NOW)
    assert (res.links, res.users) == (1, 0)
    assert _link(db, TEACHER04, "S0002").status == "ended"
    assert (
        db.execute(text("SELECT status FROM users WHERE id = :u"), {"u": TEACHER04}).scalar_one()
        == "active"
    )
    open_teacher = db.execute(
        text(
            "SELECT count(*) FROM role_bindings WHERE user_id = :u AND ended_at IS NULL"
            " AND role_type = 'homeroom_teacher'"
        ),
        {"u": TEACHER04},
    ).scalar_one()
    assert open_teacher == 1


def test_archive_keeps_staff_account_without_current_binding(db):
    # 老师这学年没有任职(教师绑定都已结束),但仍是教职工账号:家长绑定归档不能连带归档账号
    db.execute(
        text(
            "UPDATE role_bindings SET ended_at = :t WHERE user_id = :u"
            " AND role_type NOT IN ('primary_parent', 'secondary_parent')"
        ),
        {"t": NOW - timedelta(days=30), "u": TEACHER04},
    )
    _age(db, TEACHER04, "S0002")
    res = archive_expired(db, SCHOOL, NOW)
    assert (res.links, res.users) == (1, 0)
    assert (
        db.execute(text("SELECT status FROM users WHERE id = :u"), {"u": TEACHER04}).scalar_one()
        == "active"
    )


def _collect(pubsub, want: int = 1, timeout: float = 2.0) -> list[dict]:
    import json
    import time

    got: list[dict] = []
    end = time.monotonic() + timeout
    while time.monotonic() < end and len(got) < want:
        msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
        if msg:
            got.append(json.loads(msg["data"]))
    return got


def test_archive_publishes_revoked(db, redis_client, monkeypatch):
    from app.ws import hub
    from app.ws.hub import CHANNEL, REVOKED

    pubsub = redis_client.pubsub()
    pubsub.subscribe(CHANNEL)
    pubsub.get_message(timeout=1)  # 订阅确认
    _age(db, PARENT02, "S0001")  # 只有一个孩子
    # 测试库在外层事务里,另开连接看不到数据;改为记录发布时 commit 是否已发生
    seen: list[str] = []
    committed: list[bool] = []
    real_commit, real = db.commit, hub.publish

    def commit():
        real_commit()
        committed.append(True)

    def spy(redis, user_ids, event):
        status = db.execute(
            text("SELECT status FROM users WHERE id = :u"), {"u": PARENT02}
        ).scalar_one()
        seen.append(status if committed else "before-commit")
        real(redis, user_ids, event)

    monkeypatch.setattr(db, "commit", commit)
    monkeypatch.setattr(hub, "publish", spy)
    res = archive_expired(db, SCHOOL, NOW, redis_client)
    assert res.users == 1 and res.user_ids == [UUID(PARENT02)]
    got = _collect(pubsub)
    assert seen == ["archived"]  # 发布发生在提交之后
    assert got == [{"user_ids": [PARENT02], "event": {"type": REVOKED}}]
    pubsub.close()


def test_archive_dry_run_does_not_publish(db, redis_client):
    from app.ws.hub import CHANNEL

    pubsub = redis_client.pubsub()
    pubsub.subscribe(CHANNEL)
    pubsub.get_message(timeout=1)
    _age(db, PARENT02, "S0001")
    res = archive_expired(db, SCHOOL, NOW, redis_client, dry_run=True)
    assert res.users == 1
    db.rollback()
    assert _collect(pubsub, timeout=0.5) == []
    pubsub.close()


def test_archive_audit_via_is_caller_supplied(db):
    _age(db, PARENT02, "S0001")
    archive_expired(db, SCHOOL, NOW, via="scheduler")
    via = db.execute(
        text("SELECT extra->>'via' FROM audit_logs WHERE action = 'parent.archive'")
    ).scalar_one()
    assert via == "scheduler"


def test_archive_post_commit_failures_do_not_raise(db, redis_client, monkeypatch):
    from app.ws import hub

    _age(db, PARENT02, "S0001")
    published: list = []
    revoked: list = []

    def bad_revoke(redis, uid):
        revoked.append(uid)
        raise ConnectionError("redis down")

    monkeypatch.setattr(sessions, "revoke_all", bad_revoke)
    monkeypatch.setattr(hub, "publish", lambda *a, **k: published.append(a))
    res = archive_expired(db, SCHOOL, NOW, redis_client)
    assert res.users == 1 and res.user_ids == [UUID(PARENT02)]
    assert revoked == [UUID(PARENT02)] and len(published) == 1  # 撤销失败仍发布
    status = db.execute(
        text("SELECT status FROM users WHERE id = :u"), {"u": PARENT02}
    ).scalar_one()
    assert status == "archived"


def test_archive_publish_failure_does_not_raise(db, redis_client, monkeypatch):
    from app.ws import hub

    _age(db, PARENT02, "S0001")

    def boom(*a, **k):
        raise ConnectionError("redis down")

    monkeypatch.setattr(hub, "publish", boom)
    res = archive_expired(db, SCHOOL, NOW, redis_client)
    assert res.users == 1


def test_archive_one_revoke_failure_does_not_skip_others(db, redis_client, monkeypatch):
    _age(db, PARENT02, "S0001")
    _age(db, PARENT01, "S0017")
    _age(db, PARENT01, "S0001")
    seen: list = []

    def flaky(redis, uid):
        seen.append(uid)
        if len(seen) == 1:
            raise ConnectionError("x")

    monkeypatch.setattr(sessions, "revoke_all", flaky)
    res = archive_expired(db, SCHOOL, NOW, redis_client)
    assert res.users == 2 and len(seen) == 2
