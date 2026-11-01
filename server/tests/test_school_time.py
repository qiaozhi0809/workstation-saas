from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import text

from app.domain.schools.service import (
    active_academic_year,
    ensure_markable_date,
    school_today,
    week_monday,
    week_no,
)
from app.errors import ApiError
from tests.helpers import freeze
from tests.seed_ids import SCHOOL_ID

SCHOOL = UUID(SCHOOL_ID)


def test_school_today_crosses_midnight_in_school_tz(db, monkeypatch):
    freeze(monkeypatch, "2026-11-01T15:59:00+00:00")
    assert school_today(db, SCHOOL) == date(2026, 11, 1)
    freeze(monkeypatch, "2026-11-01T16:30:00+00:00")
    assert school_today(db, SCHOOL) == date(2026, 11, 2)


def test_school_today_follows_the_timezone_column(db, monkeypatch):
    db.execute(
        text("UPDATE schools SET timezone = 'America/New_York' WHERE id = :s"), {"s": SCHOOL}
    )
    freeze(monkeypatch, "2026-11-02T03:00:00+00:00")
    assert school_today(db, SCHOOL) == date(2026, 11, 1)


def test_week_helpers():
    assert week_monday(date(2026, 11, 1)) == date(2026, 10, 26)
    assert week_no(date(2026, 9, 1), date(2026, 11, 2)) == 10
    assert week_no(date(2026, 9, 1), date(2026, 9, 1)) == 1
    assert week_no(date(2026, 9, 1), date(2026, 8, 20)) == 1


def test_markable_dates(db):
    year = active_academic_year(db, SCHOOL)
    today = date(2026, 11, 2)
    ensure_markable_date(today, today, year)
    for bad in (date(2026, 11, 3), date(2026, 8, 31), date(2027, 7, 16)):
        with pytest.raises(ApiError) as exc:
            ensure_markable_date(bad, today, year)
        assert exc.value.code == "DATE_OUT_OF_RANGE"
