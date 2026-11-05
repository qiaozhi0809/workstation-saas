"""迁移预检:空库、脏数据拦截、提示、登记完整性。"""

import io
import re
import uuid
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from testcontainers.postgres import PostgresContainer

from app.cli import build_parser, migrate
from app.deploy import precheck
from app.deploy.precheck import (
    CHECKS,
    EXEMPT_CONSTRAINTS,
    alembic_config,
    pending_revisions,
    render,
    run_precheck,
)

VERSIONS = Path(__file__).resolve().parent.parent / "migrations" / "versions"
ALL_REVISIONS = [f"{i:04d}" for i in range(1, 11)]


@pytest.fixture(scope="module")
def pg_admin_url() -> Iterator[str]:
    with PostgresContainer("postgres:16-alpine", driver="psycopg") as pg:
        yield pg.get_connection_url()


@pytest.fixture
def fresh_engine(pg_admin_url: str) -> Iterator[Engine]:
    """每个测试一个全新的空库(同一个容器里 CREATE DATABASE)。"""
    name = f"t_{uuid.uuid4().hex[:12]}"
    admin = create_engine(pg_admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    eng = create_engine(make_url(pg_admin_url).set(database=name))
    try:
        yield eng
    finally:
        eng.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


def upgrade_to(engine: Engine, revision: str) -> None:
    command.upgrade(alembic_config(engine), revision)


def current_version(engine: Engine) -> str | None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM alembic_version")).first()
    return row[0] if row else None


def _school_year_grade(conn) -> tuple[str, str, str]:
    school = conn.execute(
        text("INSERT INTO schools (name) VALUES ('测试学校') RETURNING id")
    ).scalar()
    year = conn.execute(
        text(
            "INSERT INTO academic_years (school_id, name, start_date, end_date)"
            " VALUES (:s, '2026-2027', '2026-09-01', '2027-07-01') RETURNING id"
        ),
        {"s": school},
    ).scalar()
    grade = conn.execute(
        text(
            "INSERT INTO grades (school_id, academic_year_id, name)"
            " VALUES (:s, :y, '七年级') RETURNING id"
        ),
        {"s": school, "y": year},
    ).scalar()
    return school, year, grade


def test_empty_db_passes(fresh_engine):
    pending = pending_revisions(fresh_engine)
    assert pending == ALL_REVISIONS
    report = run_precheck(fresh_engine, pending)
    assert report.ok
    assert report.failures == []


def test_pending_revisions_after_partial_upgrade(fresh_engine):
    upgrade_to(fresh_engine, "0003")
    assert pending_revisions(fresh_engine) == ALL_REVISIONS[3:]
    upgrade_to(fresh_engine, "head")
    assert pending_revisions(fresh_engine) == []


def test_precheck_blocks_dirty_0002(fresh_engine):
    upgrade_to(fresh_engine, "0001")
    with fresh_engine.begin() as conn:
        school, year, grade = _school_year_grade(conn)
        conn.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name, seat_rows)"
                " VALUES (:s, :y, :g, '1班', 13)"
            ),
            {"s": school, "y": year, "g": grade},
        )
    pending = pending_revisions(fresh_engine)
    report = run_precheck(fresh_engine, pending)
    assert report.ok is False
    out = render(report, pending)
    assert "[不通过] 0002 classes 座位行列数:1 行不在 1–12 之间" in out
    assert "  定位:SELECT id, name, seat_rows, seat_cols FROM classes WHERE" in out
    assert "  处理建议:" in out
    assert "预检结果:不通过(1 项)。未做任何改动。" in out
    # 定位 SQL 可以直接运行并命中这一行
    locate = next(c for c in CHECKS if c.name.startswith("classes 座位行列数")).locate_sql
    with fresh_engine.connect() as conn:
        assert len(conn.execute(text(locate)).all()) == 1

    ns = build_parser().parse_args(["migrate"])
    buf = io.StringIO()
    assert migrate(ns, engine=fresh_engine, out=buf) == 2
    assert "[不通过] 0002" in buf.getvalue()
    assert current_version(fresh_engine) == "0001"


def test_precheck_blocks_duplicate_login_names_0007(fresh_engine):
    upgrade_to(fresh_engine, "0006")
    with fresh_engine.begin() as conn:
        school = conn.execute(
            text("INSERT INTO schools (name) VALUES ('测试学校') RETURNING id")
        ).scalar()
        for login in ("Teacher01", "teacher01"):
            conn.execute(
                text(
                    "INSERT INTO users (school_id, login_name, password_hash, display_name)"
                    " VALUES (:s, :l, 'x', '某老师')"
                ),
                {"s": school, "l": login},
            )
    pending = pending_revisions(fresh_engine)
    report = run_precheck(fresh_engine, pending)
    assert [c.revision for c, _ in report.failures] == ["0007"]
    assert "users_school_login_lower_key" in report.failures[0][0].constraints


def test_precheck_blocks_two_homeroom_assignments_0008(fresh_engine):
    upgrade_to(fresh_engine, "0007")
    with fresh_engine.begin() as conn:
        school, year, grade = _school_year_grade(conn)
        cls = conn.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name)"
                " VALUES (:s, :y, :g, '1班') RETURNING id"
            ),
            {"s": school, "y": year, "g": grade},
        ).scalar()
        tids = []
        for i in range(2):
            uid = conn.execute(
                text(
                    "INSERT INTO users (school_id, login_name, password_hash, display_name)"
                    " VALUES (:s, :l, 'x', '某老师') RETURNING id"
                ),
                {"s": school, "l": f"t{i}"},
            ).scalar()
            tids.append(
                conn.execute(
                    text("INSERT INTO teachers (user_id) VALUES (:u) RETURNING id"), {"u": uid}
                ).scalar()
            )
        for tid in tids:
            conn.execute(
                text(
                    "INSERT INTO teacher_assignments"
                    " (teacher_id, class_id, academic_year_id, identity)"
                    " VALUES (:t, :c, :y, 'homeroom')"
                ),
                {"t": tid, "c": cls, "y": year},
            )
    report = run_precheck(fresh_engine, pending_revisions(fresh_engine))
    assert [c.revision for c, _ in report.failures] == ["0008"]
    assert report.failures[0][1] == 1


def test_precheck_blocks_required_ack_notice_0010(fresh_engine):
    upgrade_to(fresh_engine, "0009")
    with fresh_engine.begin() as conn:
        school = conn.execute(
            text("INSERT INTO schools (name) VALUES ('测试学校') RETURNING id")
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO notices (school_id, title, content, target, target_label, require_ack)"
                " VALUES (:s, '通知', '内容', '{}', '全体', true)"
            ),
            {"s": school},
        )
    report = run_precheck(fresh_engine, pending_revisions(fresh_engine))
    assert [c.revision for c, _ in report.failures] == ["0010"]


def test_checks_for_unpending_revisions_are_skipped(fresh_engine):
    upgrade_to(fresh_engine, "0001")
    with fresh_engine.begin() as conn:
        school, year, grade = _school_year_grade(conn)
        conn.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name, seat_rows)"
                " VALUES (:s, :y, :g, '1班', 13)"
            ),
            {"s": school, "y": year, "g": grade},
        )
    # 假装 0002 已经执行过:只检查 0003 及以后
    assert run_precheck(fresh_engine, ALL_REVISIONS[2:]).ok


def test_size_notice(fresh_engine, monkeypatch):
    upgrade_to(fresh_engine, "0007")
    with fresh_engine.begin() as conn:
        for _ in range(2):
            conn.execute(text("INSERT INTO audit_logs (action, success) VALUES ('x.y', true)"))
    monkeypatch.setattr(
        precheck, "SIZE_NOTICES", tuple(replace(n, threshold_rows=1) for n in precheck.SIZE_NOTICES)
    )
    pending = pending_revisions(fresh_engine)
    report = run_precheck(fresh_engine, pending)
    assert report.ok is True
    out = render(report, pending)
    assert "[提示] 0008 audit_logs 有 2 行" in out
    assert "预检结果:通过。" in out


def test_render_numbers_use_thousands_separator():
    notice = precheck.SIZE_NOTICES[0]
    report = precheck.PrecheckReport(failures=[], notices=[(notice, 1234567)])
    assert "有 1,234,567 行" in render(report, ["0008"])


def test_all_check_sql_runs_on_head_schema(engine):
    """count_sql / locate_sql 在最新表结构上都能执行(种子数据不违反任何已登记约束)。"""
    with engine.connect() as conn:
        for c in CHECKS:
            assert conn.execute(text(c.count_sql)).scalar_one() == 0, c.name
            conn.execute(text(c.locate_sql)).all()


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _revision_sqls() -> list[tuple[str, str]]:
    return [
        (p.name[:4], _strip_comments(p.read_text(encoding="utf-8")))
        for p in sorted(VERSIONS.glob("*.up.sql"))
    ]


def _constraints_on_existing_tables() -> set[tuple[str, str]]:
    """扫描迁移 SQL,返回 (revision, 约束标识)。

    范围:对更早 revision 已建的表加的命名约束 / 唯一索引 / SET NOT NULL。
    同一迁移里 DROP CONSTRAINT 再 ADD CONSTRAINT 同名约束(重建)按 ADD 识别,同样算数。"""
    created: set[str] = set()
    found: set[tuple[str, str]] = set()
    for rev, sql in _revision_sqls():
        existing = set(created)
        for m in re.finditer(r"ALTER TABLE\s+(\w+)(.*?);", sql, re.S | re.I):
            table, body = m.group(1), m.group(2)
            if table not in existing:
                continue
            for c in re.finditer(r"ADD CONSTRAINT\s+(\w+)", body, re.I):
                found.add((rev, c.group(1)))
            for c in re.finditer(r"ALTER COLUMN\s+(\w+)\s+SET NOT NULL", body, re.I):
                found.add((rev, f"{table}.{c.group(1)}"))
        for m in re.finditer(r"CREATE UNIQUE INDEX\s+(\w+)\s+ON\s+(\w+)", sql, re.I):
            if m.group(2) in existing:
                found.add((rev, m.group(1)))
        created |= {m.group(1) for m in re.finditer(r"CREATE TABLE\s+(\w+)", sql, re.I)}
    return found


def test_every_constraint_in_migrations_has_check():
    registered = {(c.revision, name) for c in CHECKS for name in c.constraints}
    exempt = set(EXEMPT_CONSTRAINTS)
    scanned = _constraints_on_existing_tables()
    # 扫描器自身要认得出 R2 点名的几条,避免正则失效后测试空转
    for must in [
        ("0002", "classes_seat_dims"),
        ("0003", "enrollments_status_check"),
        ("0004", "enrollments_status_check"),
        ("0004", "students.mask_no"),
        ("0005", "enrollments_seat_code"),
        ("0006", "comments_one_per_content"),
        ("0007", "users_school_login_lower_key"),
        ("0008", "teacher_assignments_one_homeroom"),
        ("0009", "parent_links_ended_at_ck"),
        ("0010", "notice_recipients_ack_content_ck"),
    ]:
        assert must in scanned, must
    missing = scanned - registered - exempt
    assert not missing, (
        f"迁移里对已有表加的约束没有登记到 CHECKS(或 EXEMPT_CONSTRAINTS):{sorted(missing)}"
    )
    # 登记表里不能有迁移里不存在的名字
    assert not (registered | exempt) - scanned, sorted((registered | exempt) - scanned)
    assert all(reason.strip() for reason in EXEMPT_CONSTRAINTS.values())
