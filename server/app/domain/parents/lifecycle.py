"""家长绑定的生命周期:孩子不在读 -> 只读 -> 满一年归档。"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth import sessions

READONLY_DAYS = 365
_PARENT_ROLES = ("primary_parent", "secondary_parent")


@dataclass(frozen=True)
class ArchiveResult:
    links: int
    users: int


def close_links_for(db: Session, student_ids: Sequence[UUID], now: datetime) -> list[UUID]:
    """已没有任何 active 注册的学生:active 绑定改 readonly。返回改动的绑定 id;不提交。"""
    if not student_ids:
        return []
    rows = db.execute(
        text(
            "UPDATE parent_links SET status = 'readonly', readonly_since = :now"
            " WHERE status = 'active' AND student_id = ANY(cast(:ids as uuid[]))"
            " AND NOT EXISTS (SELECT 1 FROM enrollments e"
            " WHERE e.student_id = parent_links.student_id AND e.status = 'active')"
            " RETURNING id"
        ),
        {"now": now, "ids": list(student_ids)},
    ).all()
    return [r.id for r in rows]


def reopen_links(db: Session, link_ids: Sequence[UUID]) -> None:
    """把仍为 readonly 的绑定改回 active;不提交。"""
    if not link_ids:
        return
    db.execute(
        text(
            "UPDATE parent_links SET status = 'active', readonly_since = NULL"
            " WHERE status = 'readonly' AND id = ANY(cast(:ids as uuid[]))"
        ),
        {"ids": list(link_ids)},
    )


def archive_expired(
    db: Session,
    school_id: UUID,
    now: datetime,
    redis: Redis | None = None,
    *,
    dry_run: bool = False,
) -> ArchiveResult:
    """只读满 365 天的绑定改 ended,并结束对应 role_bindings;不再有任何未结束
    role_bindings 且不是教职工的家长账号改 archived、作废刷新令牌(redis 给了才作废)。幂等;
    dry_run 时只统计,不作废令牌也不提交,由调用方回滚。"""
    links = db.execute(
        text(
            "UPDATE parent_links pl SET status = 'ended', ended_at = :now, readonly_since = NULL"
            " FROM parents p, students s"
            " WHERE p.id = pl.parent_id AND s.id = pl.student_id AND s.school_id = :school"
            " AND pl.status = 'readonly' AND pl.readonly_since <= :cutoff"
            " RETURNING p.user_id, pl.student_id"
        ),
        {"now": now, "school": school_id, "cutoff": now - timedelta(days=READONLY_DAYS)},
    ).all()
    for r in links:
        db.execute(
            text(
                "UPDATE role_bindings SET ended_at = :now WHERE user_id = :u AND ended_at IS NULL"
                " AND role_type = ANY(:roles) AND scope->>'student_id' = :sid"
            ),
            {"now": now, "u": r.user_id, "roles": list(_PARENT_ROLES), "sid": str(r.student_id)},
        )
    users = archive_orphan_accounts(db, list({r.user_id for r in links}))
    for uid in users:
        record(
            db,
            user_id=None,
            action="parent.archive",
            success=True,
            object_type="user",
            object_id=str(uid),
            extra={"via": "cli"},
        )
    if not dry_run:
        db.commit()
        if redis is not None:
            for uid in users:
                sessions.revoke_all(redis, uid)
    return ArchiveResult(links=len(links), users=len(users))


def archive_orphan_accounts(db: Session, user_ids: Sequence[UUID]) -> list[UUID]:
    """这些账号里已没有任何未结束 role_bindings、也不是教职工(无 teachers 行)的改 archived,
    返回被归档的 id;不提交、不写审计、不作废令牌(调用方提交后再 revoke_all)。"""
    if not user_ids:
        return []
    rows = db.execute(
        text(
            "UPDATE users SET status = 'archived' WHERE id = ANY(cast(:ids as uuid[]))"
            " AND status <> 'archived'"
            " AND NOT EXISTS (SELECT 1 FROM role_bindings b"
            " WHERE b.user_id = users.id AND b.ended_at IS NULL)"
            " AND NOT EXISTS (SELECT 1 FROM teachers t WHERE t.user_id = users.id)"
            " RETURNING id"
        ),
        {"ids": list(user_ids)},
    ).all()
    return [r.id for r in rows]
