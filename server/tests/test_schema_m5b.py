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


def _columns(db, table):
    return {
        r[0]: r
        for r in db.execute(
            text(
                "SELECT column_name, is_nullable, column_default"
                " FROM information_schema.columns WHERE table_name = :t"
            ),
            {"t": table},
        )
    }


def test_users_new_columns(db):
    cols = _columns(db, "users")
    assert cols["password_changed_at"][1] == "NO"
    assert "now()" in cols["password_changed_at"][2]
    assert cols["totp_secret"][1] == "YES"
    assert cols["totp_enabled_at"][1] == "YES"


def test_new_user_defaults(db):
    user = make_user(db, "m5b_" + uuid.uuid4().hex[:6], "新用户")
    db.flush()
    row = db.execute(
        text(
            "SELECT password_changed_at IS NOT NULL, totp_secret, totp_enabled_at"
            " FROM users WHERE id = :i"
        ),
        {"i": user.id},
    ).one()
    assert tuple(row) == (True, None, None)


def test_totp_pair_constraint(db):
    user = make_user(db, "m5b_" + uuid.uuid4().hex[:6], "新用户")
    db.flush()
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE users SET totp_secret = 'x' WHERE id = :i"), {"i": user.id})
    db.rollback()
    user = make_user(db, "m5b_" + uuid.uuid4().hex[:6], "新用户")
    db.flush()
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE users SET totp_enabled_at = now() WHERE id = :i"), {"i": user.id})
    db.rollback()
    user = make_user(db, "m5b_" + uuid.uuid4().hex[:6], "新用户")
    db.flush()
    db.execute(
        text("UPDATE users SET totp_secret = 'x', totp_enabled_at = now() WHERE id = :i"),
        {"i": user.id},
    )


def _log(db, **extra):
    cols = {"school_id": SCHOOL_ID, "login_name": "nobody", "result": "success", **extra}
    names = ", ".join(cols)
    marks = ", ".join(f":{k}" for k in cols)
    return db.execute(
        text(f"INSERT INTO login_logs ({names}) VALUES ({marks}) RETURNING id"), cols
    ).scalar_one()


def test_login_logs_defaults_and_result_check(db):
    lid = _log(db, ip="10.0.0.8")
    row = db.execute(
        text("SELECT user_id, suspicious, created_at IS NOT NULL FROM login_logs WHERE id = :i"),
        {"i": lid},
    ).one()
    assert tuple(row) == (None, [], True)
    for result in ("bad_password", "unknown_user", "inactive", "locked", "totp_failed"):
        _log(db, result=result)
    with pytest.raises(IntegrityError):
        _log(db, result="weird")


def test_login_logs_user_set_null_on_delete(db):
    user = make_user(db, "m5b_" + uuid.uuid4().hex[:6], "新用户")
    db.flush()
    lid = _log(db, user_id=user.id)
    db.execute(text("DELETE FROM users WHERE id = :i"), {"i": user.id})
    assert (
        db.execute(text("SELECT user_id FROM login_logs WHERE id = :i"), {"i": lid}).scalar_one()
        is None
    )


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m5b_mig_" + uuid.uuid4().hex[:8]
    with admin.connect() as conn:
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


def test_password_changed_at_backfill(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0010")
    with eng.begin() as conn:
        sid = conn.execute(
            text("INSERT INTO schools (name) VALUES ('测试校') RETURNING id")
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO users (school_id, login_name, password_hash, display_name)"
                " VALUES (:s, 'old01', 'x', '旧用户')"
            ),
            {"s": sid},
        )
    command.upgrade(cfg, "0011")
    with eng.connect() as conn:
        delta = conn.execute(
            text(
                "SELECT abs(extract(epoch FROM now() - password_changed_at)), totp_secret"
                " FROM users WHERE login_name = 'old01'"
            )
        ).one()
    assert delta[0] < 300 and delta[1] is None


def test_downgrade_then_upgrade_roundtrip(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0010")
    with eng.connect() as conn:
        cols = {
            r[0]
            for r in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
            )
        }
        assert not cols & {"password_changed_at", "totp_secret", "totp_enabled_at"}
        assert conn.execute(text("SELECT to_regclass('login_logs')")).scalar_one() is None
        ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert ver == "0010"
    command.upgrade(cfg, "head")
    with eng.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('login_logs')")).scalar_one() is not None
