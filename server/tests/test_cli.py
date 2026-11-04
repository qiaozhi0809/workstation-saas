"""parent-archive 命令。"""

import io
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import text

from app.auth import sessions
from app.cli import build_parser, parent_archive

PARENT02 = "55555555-5555-5555-5555-555555555562"


def _run(db, redis_client, argv):
    @contextmanager
    def factory():
        yield db

    out = io.StringIO()
    ns = build_parser().parse_args(["parent-archive", *argv])
    code = parent_archive(ns, db_factory=factory, redis=redis_client, out=out)
    return code, out.getvalue()


def _age(db):
    db.execute(
        text(
            "UPDATE parent_links SET status = 'readonly', readonly_since = :t"
            " WHERE parent_id = '77777777-7777-7777-7777-777777777762'"
        ),
        {"t": datetime.now(UTC) - timedelta(days=400)},
    )
    db.commit()


def _state(db):
    return db.execute(
        text(
            "SELECT (SELECT status FROM users WHERE id = :u) AS u,"
            " (SELECT string_agg(status, ',' ORDER BY id) FROM parent_links) AS links,"
            " (SELECT count(*) FROM role_bindings WHERE ended_at IS NOT NULL) AS ended"
        ),
        {"u": PARENT02},
    ).one()


def test_parent_archive_dry_run(db, settings, redis_client):
    _age(db)
    token = sessions.issue_refresh(redis_client, settings, UUID(PARENT02))
    before = _state(db)
    code, out = _run(db, redis_client, ["--dry-run"])
    assert code == 0 and out.strip() == "将归档绑定 1 条,账号 1 个"
    assert _state(db) == before
    assert redis_client.get(sessions.refresh_key(token)) is not None
    assert (
        db.execute(
            text("SELECT count(*) FROM audit_logs WHERE action = 'parent.archive'")
        ).scalar_one()
        == 0
    )
    code, out = _run(db, redis_client, [])
    assert code == 0 and out.strip() == "已归档绑定 1 条,账号 1 个"
    assert _state(db).u == "archived"


def test_year_rollback_upgrade_id_option():
    ns = build_parser().parse_args(
        [
            "year-upgrade",
            "rollback",
            "--yes",
            "--upgrade-id",
            "11111111-1111-1111-1111-111111111111",
        ]
    )
    assert str(ns.upgrade_id) == "11111111-1111-1111-1111-111111111111"
    assert build_parser().parse_args(["year-upgrade", "rollback"]).upgrade_id is None
