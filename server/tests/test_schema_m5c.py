import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from app.models import Camera, Period, TimetableEntry
from tests.factories import make_class, make_teacher_account
from tests.seed_ids import SCHOOL_ID, YEAR_ID

SERVER_DIR = Path(__file__).resolve().parent.parent
NEW_TABLES = ("periods", "timetable_entries", "cameras")


def _insert(db, table, **cols):
    names = ", ".join(cols)
    marks = ", ".join(f":{k}" for k in cols)
    return db.execute(
        text(f"INSERT INTO {table} ({names}) VALUES ({marks}) RETURNING id"), cols
    ).scalar_one()


def _rejects(db, table, **cols):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            _insert(db, table, **cols)


def _period(db, **extra):
    cols = {"school_id": SCHOOL_ID, "no": 1, "starts_at": "08:00", "ends_at": "08:40", **extra}
    return _insert(db, "periods", **cols)


def test_period_checks_and_unique(db):
    _period(db)
    _rejects(db, "periods", school_id=SCHOOL_ID, no=1, starts_at="09:00", ends_at="09:40")
    _rejects(db, "periods", school_id=SCHOOL_ID, no=0, starts_at="09:00", ends_at="09:40")
    _rejects(db, "periods", school_id=SCHOOL_ID, no=13, starts_at="09:00", ends_at="09:40")
    _rejects(db, "periods", school_id=SCHOOL_ID, no=2, starts_at="09:40", ends_at="09:40")
    _rejects(db, "periods", school_id=SCHOOL_ID, no=2, starts_at="10:00", ends_at="09:40")
    _period(db, no=12, starts_at="18:00", ends_at="18:40")


def _entry(**extra):
    return {"academic_year_id": YEAR_ID, "weekday": 1, "period_no": 1, "subject": "语文", **extra}


def test_timetable_checks_unique_and_defaults(db):
    cid = make_class(db, "课表班")
    eid = _insert(db, "timetable_entries", class_id=cid, **_entry())
    assert db.execute(
        text("SELECT teacher_id, updated_at IS NOT NULL FROM timetable_entries WHERE id = :i"),
        {"i": eid},
    ).one() == (None, True)
    _rejects(db, "timetable_entries", class_id=cid, **_entry(subject="数学"))
    _rejects(db, "timetable_entries", class_id=cid, **_entry(weekday=0, period_no=2))
    _rejects(db, "timetable_entries", class_id=cid, **_entry(weekday=8, period_no=2))
    _insert(db, "timetable_entries", class_id=cid, **_entry(weekday=7, period_no=2))
    # 同一格换班级不冲突
    other = make_class(db, "课表班乙")
    _insert(db, "timetable_entries", class_id=other, **_entry())


def test_teacher_delete_sets_entry_teacher_null(db):
    cid = make_class(db, "课表班丙")
    user = make_teacher_account(db)
    tid = db.execute(
        text("SELECT id FROM teachers WHERE user_id = :u"), {"u": user.id}
    ).scalar_one()
    eid = _insert(db, "timetable_entries", class_id=cid, teacher_id=tid, **_entry())
    db.execute(text("DELETE FROM teachers WHERE id = :i"), {"i": tid})
    row = db.execute(
        text("SELECT teacher_id FROM timetable_entries WHERE id = :i"), {"i": eid}
    ).scalar_one()
    assert row is None


def test_class_delete_cascades_entries_and_nulls_camera(db):
    cid = make_class(db, "课表班丁")
    eid = _insert(db, "timetable_entries", class_id=cid, **_entry())
    cam = _insert(
        db, "cameras", school_id=SCHOOL_ID, name="讲台", class_id=cid, location="教室",
        rtsp_url="rtsp://10.0.0.5/stream1",
    )  # fmt: skip
    db.execute(text("DELETE FROM classes WHERE id = :i"), {"i": cid})
    assert (
        db.execute(
            text("SELECT count(*) FROM timetable_entries WHERE id = :i"), {"i": eid}
        ).scalar()
        == 0
    )
    assert (
        db.execute(text("SELECT class_id FROM cameras WHERE id = :i"), {"i": cam}).scalar_one()
        is None
    )


def _camera(**extra):
    return {
        "school_id": SCHOOL_ID,
        "name": "走廊东",
        "location": "走廊",
        "rtsp_url": "rtsp://10.0.0.6/stream1",
        **extra,
    }


def test_camera_defaults_and_checks(db):
    cid = _insert(db, "cameras", **_camera())
    row = db.execute(
        text(
            "SELECT enabled, transcode, rtsp_username, rtsp_password, class_id,"
            " created_at IS NOT NULL, updated_at IS NOT NULL FROM cameras WHERE id = :i"
        ),
        {"i": cid},
    ).one()
    assert tuple(row) == (True, False, None, None, None, True, True)
    _rejects(db, "cameras", **_camera(name=""))
    _rejects(db, "cameras", **_camera(name="长" * 31))
    _insert(db, "cameras", **_camera(name="长" * 30))
    _rejects(db, "cameras", **_camera(location="楼顶"))
    for loc in ("教室", "走廊", "操场", "食堂", "其他"):
        _insert(db, "cameras", **_camera(location=loc))


def test_orm_models_match_tables(db):
    cid = make_class(db, "ORM 班")
    db.add_all(
        [
            Period(school_id=uuid.UUID(SCHOOL_ID), no=3, starts_at=_t(9), ends_at=_t(10)),
            TimetableEntry(
                class_id=cid,
                academic_year_id=uuid.UUID(YEAR_ID),
                weekday=2,
                period_no=3,
                subject="数学",
            ),
            Camera(
                school_id=uuid.UUID(SCHOOL_ID),
                name="操场",
                location="操场",
                rtsp_url="rtsp://10.0.0.7/s",
                rtsp_username="v2:xx",
                rtsp_password="v2:yy",
            ),
        ]
    )
    db.flush()


def _t(hour):
    from datetime import time

    return time(hour, 0)


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m5c_mig_" + uuid.uuid4().hex[:8]
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


def _exists(eng, table):
    with eng.connect() as conn:
        return conn.execute(text("SELECT to_regclass(:t)"), {"t": table}).scalar_one() is not None


def test_roundtrip_upgrade_downgrade_upgrade(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "head")
    assert all(_exists(eng, t) for t in NEW_TABLES)
    command.downgrade(cfg, "0011")
    assert not any(_exists(eng, t) for t in NEW_TABLES)
    with eng.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0011"
    command.upgrade(cfg, "head")
    assert all(_exists(eng, t) for t in NEW_TABLES)
