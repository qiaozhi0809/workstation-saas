from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.errors import ApiError
from app.models import AcademicYear, School


def active_academic_year(db: Session, school_id: UUID) -> AcademicYear | None:
    return db.scalars(
        select(AcademicYear).where(
            AcademicYear.school_id == school_id, AcademicYear.is_active.is_(True)
        )
    ).first()


def school_tz(db: Session, school_id: UUID) -> ZoneInfo:
    name = db.scalars(select(School.timezone).where(School.id == school_id)).one()
    return ZoneInfo(name)


def school_today(db: Session, school_id: UUID) -> date:
    return clock.utc_now().astimezone(school_tz(db, school_id)).date()


def week_monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_no(start_date: date, day: date) -> int:
    return max(1, (week_monday(day) - week_monday(start_date)).days // 7 + 1)


def local_day_start_utc(day: date, tz: ZoneInfo) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(UTC)


def require_active_year(db: Session, school_id: UUID) -> AcademicYear:
    year = active_academic_year(db, school_id)
    if year is None:
        raise ApiError(409, "NO_ACTIVE_YEAR", "当前没有进行中的学年")
    return year


def ensure_markable_date(day: date, today: date, year: AcademicYear) -> None:
    if day > today or not (year.start_date <= day <= year.end_date):
        raise ApiError(400, "DATE_OUT_OF_RANGE", "只能记录本学年内、不晚于今天的考勤")
