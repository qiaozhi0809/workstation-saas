import uuid
from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from tests.seed_ids import GRADE_ID, TEACHER_USER_ID, YEAR_ID

SERVER_DIR = Path(__file__).resolve().parent.parent


def test_new_columns_exist(db):
    stage = db.execute(text("SELECT stage FROM grades WHERE id = :i"), {"i": GRADE_ID}).scalar_one()
    assert stage is None
    term2 = db.execute(
        text("SELECT term2_start FROM academic_years WHERE id = :i"), {"i": YEAR_ID}
    ).scalar_one()
    assert term2 is None
    flag = db.execute(
        text("SELECT must_change_password FROM users WHERE id = :i"), {"i": TEACHER_USER_ID}
    ).scalar_one()
    assert flag is False


def test_stage_is_checked(db):
    db.execute(text("UPDATE grades SET stage = '初中' WHERE id = :i"), {"i": GRADE_ID})
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE grades SET stage = '大学' WHERE id = :i"), {"i": GRADE_ID})


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        (date(2027, 2, 20), True),
        (None, True),
        (date(2026, 9, 1), False),
        (date(2027, 7, 15), False),
        (date(2026, 8, 1), False),
    ],
)
def test_term2_start_must_be_inside_year(db, value, ok):
    stmt = text("UPDATE academic_years SET term2_start = :v WHERE id = :i")
    params = {"v": value, "i": YEAR_ID}
    if ok:
        db.execute(stmt, params)
    else:
        with pytest.raises(IntegrityError):
            db.execute(stmt, params)


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m3a_mig"
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


def test_migration_dedupes_comments(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0005")
    ids = {k: str(uuid.uuid4()) for k in ("school", "year", "grade", "cls", "stu", "enr")}
    keep, dup, other = (str(uuid.uuid4()) for _ in range(3))
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
                "INSERT INTO students (id, school_id, mk, name)"
                " VALUES (:stu, :school, 'M1', '虚构一')"
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
        for cid, content, ts in (
            (dup, "认真好学", "2026-10-02 08:00:00+00"),
            (keep, "认真好学", "2026-10-01 08:00:00+00"),
            (other, "乐于助人", "2026-10-03 08:00:00+00"),
        ):
            conn.execute(
                text(
                    "INSERT INTO comments (id, student_id, enrollment_id, class_id,"
                    " academic_year_id, semester, content, created_at)"
                    " VALUES (:id, :stu, :enr, :cls, :year, '2026-2027 第一学期', :c, :ts)"
                ),
                {**ids, "id": cid, "c": content, "ts": ts},
            )
    command.upgrade(cfg, "0006")
    with eng.connect() as conn:
        left = {str(r[0]) for r in conn.execute(text("SELECT id FROM comments"))}
    assert left == {keep, other}
    command.downgrade(cfg, "0005")
    command.upgrade(cfg, "head")
