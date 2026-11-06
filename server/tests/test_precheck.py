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
    REVIEWED_REVISIONS,
    alembic_config,
    pending_revisions,
    render,
    run_precheck,
)

VERSIONS = Path(__file__).resolve().parent.parent / "migrations" / "versions"
ALL_REVISIONS = [f"{i:04d}" for i in range(1, 14)]


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


@pytest.fixture(scope="module")
def head_engine(pg_admin_url: str) -> Iterator[Engine]:
    """一个升到 head 的空库,供"每条 Check 都能查出脏数据"的测试在事务里反复使用。"""
    name = f"t_{uuid.uuid4().hex[:12]}"
    admin = create_engine(pg_admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    eng = create_engine(make_url(pg_admin_url).set(database=name))
    try:
        upgrade_to(eng, "head")
        yield eng
    finally:
        eng.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


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


_ID = r'(?:"?\w+"?\.)?"?(\w+)"?'  # 可带 schema 前缀、可带双引号


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _revision_sqls() -> list[tuple[str, str]]:
    return [(p.name[:4], p.read_text(encoding="utf-8")) for p in sorted(VERSIONS.glob("*.up.sql"))]


def scan_constraints(revisions: list[tuple[str, str]]) -> set[tuple[str, str]]:
    """扫描迁移 SQL,返回 (revision, 约束标识)。

    范围:对更早 revision 已建的表加的 命名 CHECK/UNIQUE 约束、无名 ADD CHECK/UNIQUE(标识
    "表.CHECK#序号" / "表.UNIQUE#序号",序号为该 ALTER 里无名约束的出现顺序)、
    唯一索引、SET NOT NULL("表.列")。
    同一迁移里 DROP CONSTRAINT 再 ADD CONSTRAINT 同名约束(重建)按 ADD 识别,同样算数。
    容忍 ONLY / IF [NOT] EXISTS / CONCURRENTLY 与双引号标识符。"""
    created: set[str] = set()
    found: set[tuple[str, str]] = set()
    for rev, raw in revisions:
        sql = _strip_comments(raw)
        existing = set(created)
        for m in re.finditer(
            rf"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?{_ID}(.*?);", sql, re.S | re.I
        ):
            table, body = m.group(1), m.group(2)
            if table not in existing:
                continue
            for c in re.finditer(r'ADD\s+CONSTRAINT\s+"?(\w+)"?\s+(?:CHECK|UNIQUE)\b', body, re.I):
                found.add((rev, c.group(1)))
            for n, c in enumerate(re.finditer(r"ADD\s+(CHECK|UNIQUE)\b", body, re.I), 1):
                found.add((rev, f"{table}.{c.group(1).upper()}#{n}"))
            for c in re.finditer(r'ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+SET\s+NOT\s+NULL', body, re.I):
                found.add((rev, f"{table}.{c.group(1)}"))
        for m in re.finditer(
            rf"CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"
            rf'"?(\w+)"?\s+ON\s+(?:ONLY\s+)?{_ID}',
            sql,
            re.I,
        ):
            if m.group(2) in existing:
                found.add((rev, m.group(1)))
        created |= {
            m.group(1)
            for m in re.finditer(rf"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?{_ID}", sql, re.I)
        }
    return found


def test_scanner_handles_syntax_variants():
    sqls = [
        ("0001", 'CREATE TABLE IF NOT EXISTS public."t1" (id int); CREATE TABLE t2 (id int);'),
        (
            "0002",
            """
            -- ALTER TABLE t1 ADD CONSTRAINT commented_out CHECK (true);
            ALTER TABLE ONLY IF EXISTS public."t1"
              ADD COLUMN c int CHECK (c > 0),
              ADD CONSTRAINT "q_ck" CHECK (id > 0),
              ADD UNIQUE (id),
              ADD CHECK (id < 10),
              ALTER COLUMN "id" SET NOT NULL,
              ALTER c SET NOT NULL;
            ALTER TABLE t2 ADD CONSTRAINT t2_fk FOREIGN KEY (id) REFERENCES t1(id);
            ALTER TABLE new_table ADD CONSTRAINT nt_ck CHECK (true);
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "u_idx" ON ONLY public."t2" (id);
            CREATE INDEX plain_idx ON t2 (id);
            CREATE TABLE new_table (id int);
            CREATE UNIQUE INDEX new_idx ON new_table (id);
            """,
        ),
        ("0003", "ALTER TABLE new_table DROP CONSTRAINT nt_ck, ADD CONSTRAINT nt_ck CHECK (id>1);"),
    ]
    assert scan_constraints(sqls) == {
        ("0002", "q_ck"),
        ("0002", "t1.UNIQUE#1"),
        ("0002", "t1.CHECK#2"),
        ("0002", "t1.id"),
        ("0002", "t1.c"),
        ("0002", "u_idx"),
        ("0003", "nt_ck"),
    }


def _constraints_on_existing_tables() -> set[tuple[str, str]]:
    return scan_constraints(_revision_sqls())


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


def test_every_revision_is_reviewed():
    """L113:扫描器只认命名 CHECK / UNIQUE / 唯一索引 / SET NOT NULL,ALTER TYPE、DO 块、
    ADD COLUMN NOT NULL DEFAULT、FK 回填都是盲区。每个 revision 都要人工核对后签进
    REVIEWED_REVISIONS,新迁移不签收这里就红。"""
    on_disk = {p.name[:4] for p in VERSIONS.glob("*.py")}
    assert on_disk == set(ALL_REVISIONS)
    assert on_disk - REVIEWED_REVISIONS == set(), "有迁移没有人工签收"
    assert REVIEWED_REVISIONS - on_disk == set(), "签收表里有不存在的迁移"


class _Base:
    """一个事务里的最小数据骨架,按需造班级 / 学生 / 在读记录 / 用户。"""

    def __init__(self, conn):
        self.conn = conn
        self.school, self.year, self.grade = _school_year_grade(conn)
        self._n = 0

    def _next(self) -> int:
        self._n += 1
        return self._n

    def klass(self, **cols) -> str:
        cols = {"name": f"班{self._next()}", **cols}
        names = ", ".join(cols)
        marks = ", ".join(f":{k}" for k in cols)
        return self.conn.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, "
                f"{names}) VALUES (:s, :y, :g, {marks}) RETURNING id"
            ),
            {"s": self.school, "y": self.year, "g": self.grade, **cols},
        ).scalar()

    def enrollment(self, class_id: str, **cols) -> str:
        n = self._next()
        sid = self.conn.execute(
            text(
                "INSERT INTO students (school_id, mk, name) VALUES (:s, :mk, '某学生') RETURNING id"
            ),
            {"s": self.school, "mk": f"mk{n}"},
        ).scalar()
        cols = {"status": "active", **cols}
        names = ", ".join(cols)
        marks = ", ".join(f":{k}" for k in cols)
        return self.conn.execute(
            text(
                "INSERT INTO enrollments (student_id, class_id, academic_year_id, "
                f"{names}) VALUES (:sid, :c, :y, {marks}) RETURNING id"
            ),
            {"sid": sid, "c": class_id, "y": self.year, **cols},
        ).scalar()

    def user(self, login: str) -> str:
        return self.conn.execute(
            text(
                "INSERT INTO users (school_id, login_name, password_hash, display_name)"
                " VALUES (:s, :l, 'x', '某人') RETURNING id"
            ),
            {"s": self.school, "l": login},
        ).scalar()

    def teacher(self) -> str:
        uid = self.user(f"t{self._next()}")
        return self.conn.execute(
            text("INSERT INTO teachers (user_id) VALUES (:u) RETURNING id"), {"u": uid}
        ).scalar()

    def assignment(self, teacher_id: str, class_id: str, ended: bool = False) -> None:
        self.conn.execute(
            text(
                "INSERT INTO teacher_assignments"
                " (teacher_id, class_id, academic_year_id, identity, ended_at)"
                " VALUES (:t, :c, :y, 'homeroom', CASE WHEN :e THEN now() END)"
            ),
            {"t": teacher_id, "c": class_id, "y": self.year, "e": ended},
        )

    def notice(self, **cols) -> str:
        cols = {"title": "通知", "content": "内容", "target_label": "全体", **cols}
        names = ", ".join(cols)
        marks = ", ".join(f":{k}" for k in cols)
        return self.conn.execute(
            text(
                f"INSERT INTO notices (school_id, target, {names})"
                f" VALUES (:s, '{{}}', {marks}) RETURNING id"
            ),
            {"s": self.school, **cols},
        ).scalar()


def _dirty_seat_dims(b: _Base) -> int:
    b.klass(seat_rows=13)
    b.klass(seat_cols=12, seat_rows=0)
    b.klass(seat_cols=14)  # 只有列数越界(须为偶数,否则撞 classes_desk_cols):检查两半都要各自生效
    b.klass(seat_cols=0)
    b.klass()  # 合法班级不计入
    return 4


def _dirty_seat_pair(b: _Base) -> int:
    c = b.klass()
    b.enrollment(c, seat_row=1)
    b.enrollment(c, seat_col=2)
    b.enrollment(c, seat_row=2, seat_col=2)  # 成对,不计入
    b.enrollment(c)  # 都为空,不计入
    return 2


def _dirty_one_per_seat(b: _Base) -> int:
    c = b.klass()
    b.enrollment(c, seat_row=1, seat_col=1)
    b.enrollment(c, seat_row=1, seat_col=1)  # 同座 -> 1 组
    b.enrollment(c, seat_row=3, seat_col=1)
    b.enrollment(c, seat_row=3, seat_col=1, status="graduated")  # 非在读,不计入
    b.enrollment(c, seat_row=2)  # seat_col 为 NULL(行列不成对,另一条 Check 管),不计入
    b.enrollment(c, seat_row=2)
    return 1


def _dirty_status(b: _Base) -> dict[str, int]:
    c = b.klass()
    b.enrollment(c, status="bogus")
    b.enrollment(c, status="promoted")
    b.enrollment(c, status="removed")
    return {"0003": 2, "0004": 1}


def _dirty_seat_code(b: _Base) -> int:
    c = b.klass()
    b.enrollment(c, seat_row=0, seat_col=3)  # 讲台边只允许 -2,-1,1,2
    b.enrollment(c, seat_row=-1, seat_col=1)
    b.enrollment(c, seat_row=0, seat_col=1)  # 合法
    b.enrollment(c)  # 座位为 NULL,不计入
    b.enrollment(c, seat_row=0)  # seat_col 为 NULL:CHECK 结果为 NULL,按 PG 语义不违规
    return 2


def _dirty_login(b: _Base) -> int:
    for login in ("Abc", "abc", "X1", "x1", "solo"):
        b.user(login)
    return 2


def _dirty_homeroom(b: _Base) -> int:
    c1, c2, c3 = b.klass(), b.klass(), b.klass()
    for c, k in ((c1, 2), (c2, 3)):
        for _ in range(k):
            b.assignment(b.teacher(), c)
    b.assignment(b.teacher(), c3)
    b.assignment(b.teacher(), c3, ended=True)  # 已结束的不算
    return 2


def _dirty_require_ack(b: _Base) -> int:
    b.notice(require_ack=True)
    b.notice(require_ack=True)
    b.notice(require_ack=False)
    return 2


def _dirty_ack_content(b: _Base) -> int:
    nid = b.notice()
    for content, n in (("a" * 201, 1), ("b" * 200, 2), (None, 3)):
        b.conn.execute(
            text(
                "INSERT INTO notice_recipients (notice_id, user_id, ack_content)"
                " VALUES (:n, :u, :c)"
            ),
            {"n": nid, "u": b.user(f"r{n}"), "c": content},
        )
    return 1


# (revision, name 前缀) -> (要先去掉的约束 / 索引, 造脏数据并返回期望的违规数)
DIRTY_CASES = {
    ("0002", "classes 座位行列数"): (
        ["ALTER TABLE classes DROP CONSTRAINT classes_seat_dims"],
        _dirty_seat_dims,
    ),
    ("0002", "enrollments 座位行列成对"): (
        ["ALTER TABLE enrollments DROP CONSTRAINT enrollments_seat_pair"],
        _dirty_seat_pair,
    ),
    ("0002", "enrollments 同座唯一"): (
        [
            "DROP INDEX enrollments_one_per_seat",
            "ALTER TABLE enrollments DROP CONSTRAINT enrollments_seat_pair",
        ],
        _dirty_one_per_seat,
    ),
    ("0003", "enrollments 状态取值"): (
        ["ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check"],
        lambda b: _dirty_status(b)["0003"],
    ),
    ("0004", "enrollments 状态取值"): (
        ["ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check"],
        lambda b: _dirty_status(b)["0004"],
    ),
    ("0005", "enrollments 座位编码"): (
        [
            "ALTER TABLE enrollments DROP CONSTRAINT enrollments_seat_code",
            "ALTER TABLE enrollments DROP CONSTRAINT enrollments_seat_pair",
        ],
        _dirty_seat_code,
    ),
    ("0007", "users 登录名大小写重复"): (["DROP INDEX users_school_login_lower_key"], _dirty_login),
    ("0008", "teacher_assignments 班主任唯一"): (
        ["DROP INDEX teacher_assignments_one_homeroom"],
        _dirty_homeroom,
    ),
    ("0010", "notices 需回执标记"): (
        ["ALTER TABLE notices DROP CONSTRAINT notices_require_ack_ck"],
        _dirty_require_ack,
    ),
    ("0010", "notice_recipients 留言长度"): (
        ["ALTER TABLE notice_recipients DROP CONSTRAINT notice_recipients_ack_content_ck"],
        _dirty_ack_content,
    ),
}


def test_every_check_has_a_dirty_case():
    assert {(c.revision, c.name) for c in CHECKS} == set(DIRTY_CASES)


@pytest.mark.parametrize("check", CHECKS, ids=lambda c: f"{c.revision}-{c.name}")
def test_check_counts_and_locates_dirty_rows(head_engine, check):
    drops, make_dirty = DIRTY_CASES[(check.revision, check.name)]
    with head_engine.connect() as conn:
        trans = conn.begin()
        try:
            for stmt in drops:  # head 库上约束已存在,先去掉才能插脏数据(DDL 随事务回滚)
                conn.execute(text(stmt))
            expected = make_dirty(_Base(conn))
            assert conn.execute(text(check.count_sql)).scalar_one() == expected
            assert len(conn.execute(text(check.locate_sql)).all()) == expected
        finally:
            trans.rollback()
