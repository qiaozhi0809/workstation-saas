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


def _notice(db, **extra) -> uuid.UUID:
    cols = {
        "school_id": SCHOOL_ID,
        "title": "测试通知",
        "content": "内容",
        "target": '{"type":"school"}',
        "target_label": "全校",
        **extra,
    }
    names = ", ".join(cols)
    marks = ", ".join(
        f"CAST(:{k} AS jsonb)" if k in ("target", "ack_options") else f":{k}" for k in cols
    )
    return db.execute(
        text(f"INSERT INTO notices ({names}) VALUES ({marks}) RETURNING id"), cols
    ).scalar_one()


def _recipient(db, notice_id, **extra):
    user = make_user(db, "r_" + uuid.uuid4().hex[:8], "收件人")
    cols = {"notice_id": notice_id, "user_id": user.id, **extra}
    names = ", ".join(cols)
    marks = ", ".join(f":{k}" for k in cols)
    db.execute(text(f"INSERT INTO notice_recipients ({names}) VALUES ({marks})"), cols)
    return user.id


def _student(db) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO students (school_id, mk, name, gender, student_no, avatar_seed)"
            " VALUES (:s, :mk, '测试生', '男', :no, 'x') RETURNING id"
        ),
        {"s": SCHOOL_ID, "mk": "T" + uuid.uuid4().hex[:6], "no": uuid.uuid4().hex[:8]},
    ).scalar_one()


def test_new_columns_and_defaults(db):
    cols = {
        (r[0], r[1]): r
        for r in db.execute(
            text(
                "SELECT table_name, column_name, column_default, is_nullable"
                " FROM information_schema.columns"
                " WHERE table_name IN ('notices','notice_recipients')"
            )
        )
    }
    for c in ("audience", "ack_kind", "ack_options", "ack_allow_note", "ack_deadline", "class_id"):
        assert ("notices", c) in cols
    assert ("notice_recipients", "ack_choice") in cols
    nid = _notice(db)
    row = db.execute(
        text(
            "SELECT audience, ack_kind, ack_options, ack_allow_note, ack_deadline, class_id"
            " FROM notices WHERE id = :i"
        ),
        {"i": nid},
    ).one()
    assert tuple(row) == ("teachers", "none", None, False, None, None)


def test_choice_without_options_rejected(db):
    with pytest.raises(IntegrityError):
        _notice(db, require_ack=True, ack_kind="choice")


def test_options_without_choice_rejected(db):
    with pytest.raises(IntegrityError):
        _notice(db, require_ack=True, ack_kind="confirm", ack_options='["是","否"]')


def test_choice_with_options_accepted(db):
    _notice(db, require_ack=True, ack_kind="choice", ack_options='["参加","不参加"]')


def test_require_ack_must_match_ack_kind(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        _notice(db, require_ack=True, ack_kind="none")
    with pytest.raises(IntegrityError), db.begin_nested():
        _notice(db, require_ack=False, ack_kind="confirm")
    _notice(db, require_ack=True, ack_kind="confirm")


def test_invalid_audience_and_ack_kind_rejected(db):
    with pytest.raises(IntegrityError):
        _notice(db, audience="students")


def test_ack_content_length_limit(db):
    nid = _notice(db)
    _recipient(db, nid, ack_content="字" * 200)
    with pytest.raises(IntegrityError):
        _recipient(db, nid, ack_content="字" * 201)


def test_delete_notice_cascades_notice_students(db):
    nid = _notice(db, audience="parents")
    parent_user = _recipient(db, nid)
    stu = _student(db)
    db.execute(
        text(
            "INSERT INTO notice_students (notice_id, student_id, parent_user_id)"
            " VALUES (:n, :s, :p)"
        ),
        {"n": nid, "s": stu, "p": parent_user},
    )
    assert db.execute(text("SELECT count(*) FROM notice_students")).scalar_one() == 1
    db.execute(text("DELETE FROM notices WHERE id = :i"), {"i": nid})
    assert db.execute(text("SELECT count(*) FROM notice_students")).scalar_one() == 0


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m4b_mig"
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
    command.downgrade(cfg, "0009")
    with eng.connect() as conn:
        cols = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = 'notices'"
                )
            )
        }
        assert "audience" not in cols
        tables = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables"
                    " WHERE table_name = 'notice_students'"
                )
            )
        }
        assert not tables
    command.upgrade(cfg, "head")
