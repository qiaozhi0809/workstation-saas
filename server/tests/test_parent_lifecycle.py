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
