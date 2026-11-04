import json
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, ProgrammingError

from tests.factories import make_class, make_teacher_account
from tests.seed_ids import GRADE_ID, SCHOOL_ID, TEACHER_USER_ID, YEAR_ID

SERVER_DIR = Path(__file__).resolve().parent.parent
SUBJECTS = json.dumps([{"name": "语文", "full": 100}])


def _grade_exam(db) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO grade_exams (school_id, academic_year_id, grade_id, name, exam_type,"
            " date, subjects, created_by_user_id)"
            " VALUES (:s, :y, :g, '期中联考', '期中', '2026-11-10', CAST(:sub AS jsonb), :u)"
            " RETURNING id"
        ),
        {"s": SCHOOL_ID, "y": YEAR_ID, "g": GRADE_ID, "sub": SUBJECTS, "u": TEACHER_USER_ID},
    ).scalar_one()


def _class_exam(db, class_id, grade_exam_id) -> None:
    db.execute(
        text(
            "INSERT INTO exams (class_id, academic_year_id, name, exam_type, date, subjects,"
            " grade_exam_id) VALUES (:c, :y, '期中联考', '期中', '2026-11-10',"
            " CAST(:sub AS jsonb), :ge)"
        ),
        {"c": class_id, "y": YEAR_ID, "sub": SUBJECTS, "ge": grade_exam_id},
    )


def _notice(db, title="放假通知") -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO notices (school_id, from_user_id, title, content, target, target_label)"
            " VALUES (:s, :u, :t, '内容', CAST('{\"scope\":\"school\"}' AS jsonb), '全校')"
            " RETURNING id"
        ),
        {"s": SCHOOL_ID, "u": TEACHER_USER_ID, "t": title},
    ).scalar_one()


def test_tables_and_columns_exist(db):
    cols = {
        (r[0], r[1])
        for r in db.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns"
                " WHERE table_name IN ('grade_exams','notices','notice_recipients','exams')"
            )
        )
    }
    assert ("grade_exams", "grade_id") in cols
    assert ("exams", "grade_exam_id") in cols
    assert ("notices", "require_ack") in cols
    assert ("notices", "recalled_at") in cols
    assert ("notice_recipients", "ack_content") in cols


def test_same_grade_exam_same_class_twice_rejected(db):
    ge = _grade_exam(db)
    cls = make_class(db, "联考班")
    _class_exam(db, cls, ge)
    with pytest.raises(IntegrityError):
        _class_exam(db, cls, ge)


def test_plain_exams_without_grade_exam_unaffected(db):
    cls = make_class(db, "普通班")
    _class_exam(db, cls, None)
    _class_exam(db, cls, None)


def test_delete_grade_exam_cascades_class_exams(db):
    ge = _grade_exam(db)
    cls = make_class(db, "级联班")
    _class_exam(db, cls, ge)
    db.execute(text("DELETE FROM grade_exams WHERE id = :i"), {"i": ge})
    n = db.execute(text("SELECT count(*) FROM exams WHERE grade_exam_id = :i"), {"i": ge})
    assert n.scalar_one() == 0


def test_delete_notice_cascades_recipients(db):
    nid = _notice(db)
    db.execute(
        text("INSERT INTO notice_recipients (notice_id, user_id) VALUES (:n, :u)"),
        {"n": nid, "u": TEACHER_USER_ID},
    )
    db.execute(text("DELETE FROM notices WHERE id = :i"), {"i": nid})
    n = db.execute(text("SELECT count(*) FROM notice_recipients WHERE notice_id = :i"), {"i": nid})
    assert n.scalar_one() == 0


def test_notice_title_length_checked(db):
    _notice(db, "题" * 50)
    with pytest.raises(IntegrityError):
        _notice(db, "题" * 51)


def test_audit_log_indexes_exist(db):
    names = {r[0] for r in db.execute(text("SELECT indexname FROM pg_indexes"))}
    assert {"audit_logs_at", "audit_logs_action_at", "exams_one_per_grade_exam"} <= names


def _assign(db, teacher_id, class_id, ended=False):
    db.execute(
        text(
            "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity,"
            " ended_at) VALUES (:t, :c, :y, 'homeroom', CASE WHEN :e THEN now() END)"
        ),
        {"t": teacher_id, "c": class_id, "y": YEAR_ID, "e": ended},
    )


def _teacher_id(db):
    user = make_teacher_account(db)
    return db.execute(
        text("SELECT id FROM teachers WHERE user_id = :u"), {"u": user.id}
    ).scalar_one()


def test_one_active_homeroom_per_class(db):
    cls = make_class(db, "班主任班")
    _assign(db, _teacher_id(db), cls)
    with pytest.raises(IntegrityError):
        _assign(db, _teacher_id(db), cls)


def test_second_homeroom_allowed_when_previous_ended(db):
    cls = make_class(db, "换班主任班")
    _assign(db, _teacher_id(db), cls, ended=True)
    _assign(db, _teacher_id(db), cls)


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m3b_mig"
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
    command.downgrade(cfg, "0007")
    with eng.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.notices')")).scalar_one() is None
    command.upgrade(cfg, "head")


def test_upgrade_fails_readably_on_duplicate_homeroom(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0007")
    ids = {k: str(uuid.uuid4()) for k in ("school", "year", "grade", "cls", "u1", "u2", "t1", "t2")}
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
        for u, t, ln in (("u1", "t1", "dup_a"), ("u2", "t2", "dup_b")):
            conn.execute(
                text(
                    "INSERT INTO users (id, school_id, login_name, password_hash, display_name)"
                    f" VALUES (:{u}, :school, '{ln}', 'x', '虚构')"
                ),
                ids,
            )
            conn.execute(text(f"INSERT INTO teachers (id, user_id) VALUES (:{t}, :{u})"), ids)
            conn.execute(
                text(
                    "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id,"
                    f" identity) VALUES (:{t}, :cls, :year, 'homeroom')"
                ),
                ids,
            )
    with pytest.raises(ProgrammingError, match=ids["cls"]) as exc:
        command.upgrade(cfg, "0008")
    assert "2" in str(exc.value)
