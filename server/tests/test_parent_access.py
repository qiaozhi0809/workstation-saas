from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from app.domain.parents.access import (
    READONLY_DAYS,
    child_link_or_deny,
    effective_status,
    my_links,
    parent_bindings,
)
from app.errors import ApiError
from app.models import Student, User
from app.models.audit import AuditLog
from app.models.parents import Parent, ParentLink
from app.rbac.roles import Role
from tests.factories import make_user
from tests.seed_ids import STUDENT_IDS

NOW = datetime(2026, 11, 4, 8, 0, tzinfo=UTC)


def _user(db, login: str) -> User:
    return db.scalar(select(User).where(User.login_name == login))


def _link_of(db, login: str, mk: str) -> ParentLink:
    user = _user(db, login)
    return db.scalars(
        select(ParentLink)
        .join(Parent, Parent.id == ParentLink.parent_id)
        .join(Student, Student.id == ParentLink.student_id)
        .where(Parent.user_id == user.id, Student.mk == mk)
    ).one()


def _student_id(db, mk: str) -> UUID:
    return db.scalar(select(Student.id).where(Student.mk == mk))


def _mk_link(db, *, primary=True, status="active", since=None, student=STUDENT_IDS[2]):
    user = make_user(db, "pa_" + status + str(primary), "测试家长")
    parent = Parent(user_id=user.id, name="测试家长")
    db.add(parent)
    db.flush()
    link = ParentLink(
        parent_id=parent.id,
        student_id=UUID(student),
        is_primary=primary,
        status=status,
        readonly_since=since,
    )
    db.add(link)
    db.flush()
    return user, link


def test_effective_status_expiry(db):
    since = NOW - timedelta(days=READONLY_DAYS - 1)
    link = ParentLink(status="readonly", readonly_since=since)
    assert effective_status(link, NOW) == "readonly"
    assert effective_status(link, NOW + timedelta(days=1)) is None
    assert effective_status(ParentLink(status="active"), NOW) == "active"
    assert effective_status(ParentLink(status="ended"), NOW) is None


def test_my_links_filters_ended_and_expired(db):
    user = _user(db, "parent01")
    assert len(my_links(db, user.id, NOW)) == 2
    link = _link_of(db, "parent01", "S0017")
    link.status = "readonly"
    link.readonly_since = NOW - timedelta(days=READONLY_DAYS)
    db.flush()
    assert [lk.id for lk in my_links(db, user.id, NOW)] == [_link_of(db, "parent01", "S0001").id]


def test_child_link_or_deny_own_child(db):
    user = _user(db, "parent01")
    sid = _student_id(db, "S0001")
    link = child_link_or_deny(db, None, user, sid, now=NOW)
    assert link.student_id == sid
    assert child_link_or_deny(db, None, user, sid, now=NOW, write=True).is_primary


def test_child_link_or_deny_other_child(db):
    user = _user(db, "parent01")
    other = _student_id(db, "S0002")
    with pytest.raises(ApiError) as exc:
        child_link_or_deny(db, None, user, other, now=NOW)
    assert exc.value.status == 403
    rows = db.scalars(
        select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.action == "parent.view")
    ).all()
    assert len(rows) == 1
    assert rows[0].success is False
    assert rows[0].object_type == "student" and rows[0].object_id == str(other)


def test_write_requires_active_primary(db):
    secondary = _user(db, "parent02")
    sid = _student_id(db, "S0001")
    assert child_link_or_deny(db, None, secondary, sid, now=NOW).student_id == sid
    with pytest.raises(ApiError) as exc:
        child_link_or_deny(db, None, secondary, sid, now=NOW, write=True)
    assert exc.value.status == 403
    user, _ = _mk_link(db, primary=True, status="readonly", since=NOW - timedelta(days=1))
    with pytest.raises(ApiError) as exc:
        child_link_or_deny(db, None, user, UUID(STUDENT_IDS[2]), now=NOW, write=True)
    assert exc.value.status == 403


def test_parent_bindings_roles(db):
    primary = parent_bindings(_link_of(db, "parent01", "S0001"))
    secondary = parent_bindings(_link_of(db, "parent02", "S0001"))
    assert [b.role for b in primary] == [Role.primary_parent]
    assert [b.role for b in secondary] == [Role.secondary_parent]
    assert primary[0].scope.student_id == _student_id(db, "S0001")
