from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.classes.service import class_scope_of
from app.domain.classroom.schemas import Board, ClassRoleUpdated, ClassroomSummary, YearInfo
from app.domain.schools.service import school_today, school_tz, week_monday, week_no
from app.domain.students.service import require_enrollment
from app.models import AcademicYear, ClassBoard, SchoolClass
from app.rbac.bindings import Binding, can, subjects_in_class
from app.rbac.roles import CLASSROOM_PERMS

DEFAULT_BOARD = Board(
    left_title="今日课程",
    left_text="",
    right_title="今日事项",
    right_text="",
    countdown_label=None,
    countdown_date=None,
)


def get_board(db: Session, class_id: UUID) -> Board:
    row = db.scalars(select(ClassBoard).where(ClassBoard.class_id == class_id)).first()
    if row is None:
        return DEFAULT_BOARD
    return Board(
        left_title=row.left_title,
        left_text=row.left_text,
        right_title=row.right_title,
        right_text=row.right_text,
        countdown_label=row.countdown_label,
        countdown_date=row.countdown_date,
    )


def save_board(db: Session, class_id: UUID, board: Board, user_id: UUID) -> Board:
    values = {**board.model_dump(), "updated_by_user_id": user_id}
    stmt = insert(ClassBoard).values(class_id=class_id, **values)
    db.execute(stmt.on_conflict_do_update(index_elements=[ClassBoard.class_id], set_=values))
    db.commit()
    return board


def set_class_role(
    db: Session,
    class_id: UUID,
    enrollment_id: UUID,
    class_role: str | None,
    user_id: UUID,
    request: Request,
) -> ClassRoleUpdated:
    enrollment = require_enrollment(db, class_id, enrollment_id)
    enrollment.class_role = class_role
    record(
        db,
        user_id=user_id,
        action="student.update_class_role",
        success=True,
        object_type="enrollment",
        object_id=str(enrollment_id),
        request=request,
    )
    db.commit()
    return ClassRoleUpdated(enrollment_id=enrollment_id, class_role=class_role)


def build_summary(
    db: Session, cls: SchoolClass, bindings: Sequence[Binding], year: AcademicYear
) -> ClassroomSummary:
    scope = class_scope_of(cls)
    today = school_today(db, cls.school_id)
    return ClassroomSummary(
        today=today,
        timezone=school_tz(db, cls.school_id).key,
        week_no=week_no(year.start_date, today),
        week_start=week_monday(today),
        year=YearInfo(
            id=year.id, name=year.name, start_date=year.start_date, end_date=year.end_date
        ),
        seat_version=cls.seat_version,
        my_perms=[p.value for p in CLASSROOM_PERMS if can(bindings, p, scope)],
        my_subjects=subjects_in_class(bindings, cls.id),
        board=get_board(db, cls.id),
    )
