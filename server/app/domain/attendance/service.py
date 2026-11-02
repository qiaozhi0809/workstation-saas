from datetime import date
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import clock
from app.domain.attendance.schemas import (
    AttendanceDay,
    AttendanceMonth,
    AttendanceRecord,
    AttendanceUpdate,
    AttendanceUpdated,
    MonthItem,
)
from app.models import Attendance, Enrollment
from app.models import AttendanceDay as AttendanceDayRow


def day_view(db: Session, class_id: UUID, day: date) -> AttendanceDay:
    rows = db.scalars(
        select(Attendance)
        .join(Enrollment, Enrollment.id == Attendance.enrollment_id)
        .where(
            Attendance.class_id == class_id,
            Attendance.date == day,
            Enrollment.status != "removed",
        )
        .order_by(Attendance.enrollment_id)
    ).all()
    confirmed_at = db.scalars(
        select(AttendanceDayRow.confirmed_at).where(
            AttendanceDayRow.class_id == class_id, AttendanceDayRow.date == day
        )
    ).first()
    return AttendanceDay(
        date=day,
        confirmed_at=confirmed_at,
        items=[
            AttendanceRecord(
                enrollment_id=r.enrollment_id,
                status=r.status,
                reason=r.reason,
                marked_at=r.marked_at,
            )
            for r in rows
        ],
    )


def set_status(
    db: Session,
    class_id: UUID,
    enrollment: Enrollment,
    day: date,
    update: AttendanceUpdate,
    user_id: UUID,
) -> AttendanceUpdated:
    if update.status == "present":
        db.execute(
            delete(Attendance).where(
                Attendance.enrollment_id == enrollment.id, Attendance.date == day
            )
        )
        db.commit()
        return AttendanceUpdated(enrollment_id=enrollment.id, status="present", reason=None)
    stmt = insert(Attendance).values(
        enrollment_id=enrollment.id,
        class_id=class_id,
        date=day,
        status=update.status,
        reason=update.reason,
        marked_by_user_id=user_id,
        marked_at=clock.utc_now(),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Attendance.enrollment_id, Attendance.date],
        set_={
            "status": stmt.excluded.status,
            "reason": stmt.excluded.reason,
            "marked_by_user_id": stmt.excluded.marked_by_user_id,
            "marked_at": stmt.excluded.marked_at,
        },
    )
    db.execute(stmt)
    db.commit()
    return AttendanceUpdated(
        enrollment_id=enrollment.id, status=update.status, reason=update.reason
    )


def confirm_day(
    db: Session, class_id: UUID, day: date, clear: bool, user_id: UUID
) -> AttendanceDay:
    if clear:
        db.execute(
            delete(Attendance).where(Attendance.class_id == class_id, Attendance.date == day)
        )
    stmt = insert(AttendanceDayRow).values(
        class_id=class_id, date=day, confirmed_by_user_id=user_id, confirmed_at=clock.utc_now()
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[AttendanceDayRow.class_id, AttendanceDayRow.date],
        set_={
            "confirmed_by_user_id": stmt.excluded.confirmed_by_user_id,
            "confirmed_at": stmt.excluded.confirmed_at,
        },
    )
    db.execute(stmt)
    db.commit()
    return day_view(db, class_id, day)


def month_view(db: Session, class_id: UUID, month: str) -> AttendanceMonth:
    year, mon = int(month[:4]), int(month[5:])
    first = date(year, mon, 1)
    nxt = date(year + (mon == 12), mon % 12 + 1, 1)
    rows = db.execute(
        select(Attendance.enrollment_id, Attendance.date, Attendance.status)
        .join(Enrollment, Enrollment.id == Attendance.enrollment_id)
        .where(
            Attendance.class_id == class_id,
            Attendance.date >= first,
            Attendance.date < nxt,
            Enrollment.status != "removed",
        )
        .order_by(Attendance.date, Attendance.enrollment_id)
    ).all()
    return AttendanceMonth(
        month=month,
        items=[MonthItem(enrollment_id=e, date=d, status=s) for e, d, s in rows],
    )


def exceptions_on(db: Session, class_id: UUID, day: date) -> dict[UUID, str]:
    rows = db.execute(
        select(Attendance.enrollment_id, Attendance.status).where(
            Attendance.class_id == class_id, Attendance.date == day
        )
    ).all()
    return {e: s for e, s in rows}
