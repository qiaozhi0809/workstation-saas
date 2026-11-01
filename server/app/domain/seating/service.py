from uuid import UUID

from sqlalchemy import bindparam, text, update
from sqlalchemy.orm import Session

from app import clock
from app.domain.seating.schemas import SeatingSave, SeatingSaved
from app.domain.students.service import active_enrollments
from app.errors import ApiError
from app.models import Enrollment, SchoolClass, SeatArrangement


def _invalid(reason: str) -> ApiError:
    return ApiError(400, "SEAT_INVALID", "座位表无效", {"reason": reason})


def _validate(db: Session, cls: SchoolClass, body: SeatingSave) -> None:
    ids = [s.enrollment_id for s in body.seats]
    if len(set(ids)) != len(ids):
        raise _invalid("duplicate_enrollment")
    active = {e.id for e in active_enrollments(db, cls.id)}
    if any(i not in active for i in ids):
        raise _invalid("unknown_enrollment")
    if any(s.row > body.rows or s.col > body.cols for s in body.seats):
        raise _invalid("out_of_grid")
    positions = [(s.row, s.col) for s in body.seats]
    if len(set(positions)) != len(positions):
        raise _invalid("duplicate_position")


def save_seating(db: Session, cls: SchoolClass, body: SeatingSave, user_id: UUID) -> SeatingSaved:
    _validate(db, cls, body)
    version = db.execute(
        text(
            "UPDATE classes SET seat_version = seat_version + 1, seat_rows = :rows, "
            "seat_cols = :cols WHERE id = :id AND seat_version = :base RETURNING seat_version"
        ),
        {"rows": body.rows, "cols": body.cols, "id": cls.id, "base": body.base_version},
    ).scalar_one_or_none()
    if version is None:
        db.rollback()
        current = db.get(SchoolClass, cls.id, populate_existing=True)
        raise ApiError(
            409,
            "SEAT_VERSION_CONFLICT",
            "座位表已被其他人修改",
            {"current_version": current.seat_version if current else 0},
        )
    db.execute(
        update(Enrollment)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
        .values(seat_row=None, seat_col=None, seat_locked=False),
        execution_options={"synchronize_session": False},
    )
    if body.seats:
        db.connection().execute(
            update(Enrollment)
            .where(Enrollment.id == bindparam("b_id"))
            .values(
                seat_row=bindparam("b_row"),
                seat_col=bindparam("b_col"),
                seat_locked=bindparam("b_locked"),
            ),
            [
                {"b_id": s.enrollment_id, "b_row": s.row, "b_col": s.col, "b_locked": s.locked}
                for s in body.seats
            ],
        )
    db.add(
        SeatArrangement(
            class_id=cls.id,
            version=version,
            seat_rows=body.rows,
            seat_cols=body.cols,
            layout=[
                {
                    "enrollment_id": str(s.enrollment_id),
                    "row": s.row,
                    "col": s.col,
                    "locked": s.locked,
                }
                for s in body.seats
            ],
            saved_by_user_id=user_id,
            saved_at=clock.utc_now(),
        )
    )
    db.commit()
    db.expire_all()
    return SeatingSaved(version=version, rows=body.rows, cols=body.cols)
