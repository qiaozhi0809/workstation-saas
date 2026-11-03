from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.seating.arrange import first_empty, grid_of, in_grid
from app.errors import ApiError
from app.models import Enrollment, SchoolClass

Seat = tuple[int, int]


@dataclass
class Plan:
    changed: bool
    target: Seat | None = None
    occupant: Enrollment | None = None
    occupant_dest: Seat | None = None


def lock_class(db: Session, cls: SchoolClass) -> None:
    """Take the class row FOR UPDATE first, like a seating save, so seat writes serialise."""
    db.get(SchoolClass, cls.id, with_for_update=True, populate_existing=True)


def _seat_of(e: Enrollment | None) -> Seat | None:
    if e is None or e.seat_row is None or e.seat_col is None:
        return None
    return (e.seat_row, e.seat_col)


def plan_placement(
    db: Session, cls: SchoolClass, enrollment: Enrollment | None, target: Seat | None
) -> Plan:
    """Validate a seat move without mutating anything; ``enrollment`` is None for a new student."""
    g = grid_of(cls)
    if target is not None and not in_grid(g, target):
        reason = "podium_unavailable" if target[0] == 0 else "out_of_grid"
        raise ApiError(400, "SEAT_INVALID", "座位表无效", {"reason": reason})
    current = _seat_of(enrollment)
    if target == current:
        return Plan(False)
    occupied: dict[Seat, Enrollment] = {}
    own_id: UUID | None = enrollment.id if enrollment is not None else None
    for e in db.scalars(
        select(Enrollment).where(
            Enrollment.class_id == cls.id,
            Enrollment.status == "active",
            Enrollment.seat_row.is_not(None),
        )
    ):
        if e.id != own_id and e.seat_row is not None and e.seat_col is not None:
            occupied[(e.seat_row, e.seat_col)] = e
    occupant = occupied.get(target) if target is not None else None
    dest: Seat | None = None
    if occupant is not None:
        if occupant.seat_locked:
            raise ApiError(409, "SEAT_LOCKED", "目标座位上的同学已被固定")
        dest = current or first_empty(g, set(occupied), cls.seat_order, target)  # type: ignore[arg-type]
    return Plan(True, target, occupant, dest)


def place_student(
    db: Session,
    cls: SchoolClass,
    enrollment: Enrollment,
    target: Seat | None,
    plan: Plan | None = None,
) -> bool:
    """Apply a seat move; a ``plan`` from plan_placement saves a second read."""
    if plan is None:
        plan = plan_placement(db, cls, enrollment, target)
    if not plan.changed:
        return False
    if plan.occupant is not None:
        plan.occupant.seat_row = None
        plan.occupant.seat_col = None
        db.flush()
    enrollment.seat_locked = False
    enrollment.seat_row, enrollment.seat_col = plan.target if plan.target else (None, None)
    db.flush()
    if plan.occupant is not None and plan.occupant_dest is not None:
        plan.occupant.seat_row, plan.occupant.seat_col = plan.occupant_dest
        db.flush()
    cls.seat_version = SchoolClass.seat_version + 1
    db.flush()
    return True
