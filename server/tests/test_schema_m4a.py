import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from tests.factories import make_user
from tests.seed_ids import SCHOOL_ID

SERVER_DIR = Path(__file__).resolve().parent.parent


def _student(db) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO students (school_id, mk, name, gender, student_no, avatar_seed)"
            " VALUES (:s, :mk, '测试生', '男', :no, 'x') RETURNING id"
        ),
        {"s": SCHOOL_ID, "mk": "T" + uuid.uuid4().hex[:6], "no": uuid.uuid4().hex[:8]},
    ).scalar_one()


def _parent(db) -> uuid.UUID:
    user = make_user(db, "p_" + uuid.uuid4().hex[:8], "测试家长")
    return db.execute(
        text("INSERT INTO parents (user_id, name) VALUES (:u, '测试家长') RETURNING id"),
        {"u": user.id},
    ).scalar_one()


def _link(db, parent_id, student_id, *, primary=True, status="active", since=False, ended=False):
    db.execute(
        text(
            "INSERT INTO parent_links (parent_id, student_id, is_primary, status,"
            " readonly_since, ended_at) VALUES (:p, :s, :pri, :st,"
            " CASE WHEN :since THEN now() END, CASE WHEN :ended THEN now() END)"
        ),
        {
            "p": parent_id,
            "s": student_id,
            "pri": primary,
            "st": status,
            "since": since,
            "ended": ended,
        },
    )


def test_new_columns_exist(db):
    cols = {
        (r[0], r[1])
        for r in db.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns"
                " WHERE table_name IN ('parent_links','comments')"
            )
        )
    }
    for c in ("status", "readonly_since", "ended_at", "created_by_user_id"):
        assert ("parent_links", c) in cols
    assert ("comments", "parent_visible") in cols


def test_second_active_primary_rejected(db):
    stu = _student(db)
    _link(db, _parent(db), stu)
    with pytest.raises(IntegrityError):
        _link(db, _parent(db), stu)


def test_second_primary_allowed_when_previous_ended(db):
    stu = _student(db)
    _link(db, _parent(db), stu, status="ended", ended=True)
    _link(db, _parent(db), stu)


def test_readonly_without_since_rejected(db):
    with pytest.raises(IntegrityError):
        _link(db, _parent(db), _student(db), status="readonly")


def test_ended_without_ended_at_rejected(db):
    with pytest.raises(IntegrityError):
        _link(db, _parent(db), _student(db), status="ended")


def test_active_with_since_rejected(db):
    with pytest.raises(IntegrityError):
        _link(db, _parent(db), _student(db), since=True)


def test_parent_links_parent_index_exists(db):
    names = {r[0] for r in db.execute(text("SELECT indexname FROM pg_indexes"))}
    assert "parent_links_parent" in names


def test_seed_comments_parent_visible_default(db):
    rows = db.execute(text("SELECT generated_by_ai, parent_visible FROM comments")).all()
    assert rows
    assert all(visible is True for ai, visible in rows if not ai)


def test_seed_parent_bindings(db):
    n = db.execute(
        text(
            "SELECT count(*) FROM role_bindings rb JOIN users u ON u.id = rb.user_id"
            " WHERE u.phone = '13800000061' AND rb.role_type = 'primary_parent'"
        )
    ).scalar_one()
    assert n == 2
    links = db.execute(
        text(
            "SELECT count(*) FROM parent_links pl JOIN parents p ON p.id = pl.parent_id"
            " WHERE p.phone = '13800000061' AND pl.is_primary"
        )
    ).scalar_one()
    assert links == 2


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m4a_mig"
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name}"))
        conn.execute(text(f"CREATE DATABASE {name}"))
    url = make_url(pg_url).set(database=name).render_as_string(hide_password=False)
    cfg = Config(str(SERVER_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    eng = create_engine(url)
    yield cfg, eng
    eng.dispose()
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
    admin.dispose()


def test_downgrade_then_upgrade_roundtrip(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0008")
    with eng.connect() as conn:
        cols = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = 'parent_links'"
                )
            )
        }
        assert "status" not in cols
    command.upgrade(cfg, "head")


def test_migration_hides_existing_ai_comments(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0008")
    ids = {k: str(uuid.uuid4()) for k in ("school", "year", "grade", "cls", "stu", "enr")}
    with eng.begin() as conn:
        conn.execute(text("INSERT INTO schools (id, name) VALUES (:school, '迁移小学')"), ids)
        conn.execute(
            text(
                "INSERT INTO academic_years (id, school_id, name, start_date, end_date, is_active)"
                " VALUES (:year, :school, '2026-2027', '2026-09-01', '2027-07-15', true)"
            ),
            ids,
        )
        conn.execute(
            text(
                "INSERT INTO grades (id, school_id, academic_year_id, name, display_order)"
                " VALUES (:grade, :school, :year, '三年级', 3)"
            ),
            ids,
        )
        conn.execute(
            text(
                "INSERT INTO classes (id, school_id, academic_year_id, grade_id, name)"
                " VALUES (:cls, :school, :year, :grade, '三年一班')"
            ),
            ids,
        )
        conn.execute(
            text(
                "INSERT INTO students (id, school_id, mk, name, gender, student_no, avatar_seed)"
                " VALUES (:stu, :school, 'S9999', '迁移生', '男', '9999', 'x')"
            ),
            ids,
        )
        conn.execute(
            text(
                "INSERT INTO enrollments (id, student_id, class_id, academic_year_id)"
                " VALUES (:enr, :stu, :cls, :year)"
            ),
            ids,
        )
        for content, ai in (("AI 写的评语", True), ("手写评语", False)):
            conn.execute(
                text(
                    "INSERT INTO comments (student_id, enrollment_id, class_id, academic_year_id,"
                    " semester, content, generated_by_ai) VALUES (:stu, :enr, :cls, :year,"
                    " '2026-2027 第一学期', :c, :ai)"
                ),
                {**ids, "c": content, "ai": ai},
            )
    command.upgrade(cfg, "0009")
    with eng.connect() as conn:
        got = dict(conn.execute(text("SELECT generated_by_ai, parent_visible FROM comments")).all())
    assert got == {True: False, False: True}
