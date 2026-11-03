import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, STUDENT_IDS, YEAR_ID

SERVER_DIR = Path(__file__).resolve().parent.parent


def _new_class(db, **cols):
    names = ["school_id", "academic_year_id", "grade_id", "name", *cols]
    params = {
        "school_id": SCHOOL_ID,
        "academic_year_id": YEAR_ID,
        "grade_id": GRADE_ID,
        "name": "三年九班",
        **cols,
    }
    marks = ", ".join(":" + n for n in names)
    sql = f"INSERT INTO classes ({', '.join(names)}) VALUES ({marks}) RETURNING id"
    return db.execute(text(sql), params).scalar_one()


def _enrollment(db, student_id):
    return db.execute(
        text("SELECT id FROM enrollments WHERE student_id = :s"), {"s": student_id}
    ).scalar_one()


def test_new_class_defaults(db):
    cid = _new_class(db)
    row = db.execute(
        text(
            "SELECT desk_size, seat_layout, seat_order, podium_left, podium_right, room"
            " FROM classes WHERE id = :i"
        ),
        {"i": cid},
    ).one()
    assert tuple(row) == (2, "auto", "row", 0, 0, "")


def test_seed_class_is_manual_double_with_room(db):
    row = db.execute(
        text(
            "SELECT desk_size, seat_layout, seat_rows, seat_cols, room FROM classes WHERE id = :i"
        ),
        {"i": CLASS_ID},
    ).one()
    assert tuple(row) == (2, "manual", 6, 4, "求知楼 201")


def test_cols_must_be_multiple_of_desk_size(db):
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE classes SET desk_size = 3 WHERE id = :i"), {"i": CLASS_ID})


@pytest.mark.parametrize(
    ("seat_row", "seat_col", "ok"),
    [(0, -2, True), (0, 1, True), (0, 0, False), (0, 3, False), (0, -3, False), (-1, 1, False)],
)
def test_podium_seat_code_checked(db, seat_row, seat_col, ok):
    eid = _enrollment(db, STUDENT_IDS[0])
    stmt = text(
        "UPDATE enrollments SET seat_row = :r, seat_col = :c, seat_locked = false WHERE id = :e"
    )
    params = {"r": seat_row, "c": seat_col, "e": eid}
    if ok:
        db.execute(stmt, params)
    else:
        with pytest.raises(IntegrityError):
            db.execute(stmt, params)


def test_room_length_checked(db):
    with pytest.raises(IntegrityError):
        db.execute(
            text("UPDATE classes SET room = :r WHERE id = :i"), {"r": "楼" * 31, "i": CLASS_ID}
        )
    db.rollback()


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m2d_mig"
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


def _seed_at_0004(eng, seat_cols):
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
                "INSERT INTO classes"
                " (id, school_id, academic_year_id, grade_id, name, seat_rows, seat_cols)"
                " VALUES (:cls, :school, :year, :grade, '三年一班', 6, :cols)"
            ),
            {**ids, "cols": seat_cols},
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
                "INSERT INTO enrollments"
                " (id, student_id, class_id, academic_year_id, seat_row, seat_col, seat_locked)"
                " VALUES (:enr, :stu, :cls, :year, 2, 5, true)"
            ),
            ids,
        )
    return ids


def test_migration_rounds_odd_cols_up(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0004")
    ids = _seed_at_0004(eng, 5)
    command.upgrade(cfg, "0005")
    with eng.connect() as conn:
        cls = conn.execute(
            text("SELECT seat_cols, desk_size, seat_layout FROM classes WHERE id = :cls"), ids
        ).one()
        enr = conn.execute(
            text("SELECT seat_row, seat_col, seat_locked FROM enrollments WHERE id = :enr"), ids
        ).one()
    assert tuple(cls) == (6, 2, "manual")
    assert tuple(enr) == (2, 5, True)


def test_downgrade_clears_podium_seats(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0004")
    ids = _seed_at_0004(eng, 4)
    command.upgrade(cfg, "0005")
    with eng.begin() as conn:
        conn.execute(
            text(
                "UPDATE enrollments SET seat_row = 0, seat_col = -1, seat_locked = true"
                " WHERE id = :enr"
            ),
            ids,
        )
    command.downgrade(cfg, "0004")
    with eng.connect() as conn:
        enr = conn.execute(
            text("SELECT seat_row, seat_col, seat_locked FROM enrollments WHERE id = :enr"), ids
        ).one()
    assert tuple(enr) == (None, None, False)
    command.upgrade(cfg, "head")
