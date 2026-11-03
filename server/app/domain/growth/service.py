from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.growth.schemas import GrowthInput, GrowthRecordOut
from app.models import AcademicYear, Enrollment, GrowthRecord, SchoolClass, User
from app.rbac.bindings import Binding, Scope, can, has_role_in_class
from app.rbac.roles import Perm, Role


def can_delete_record(
    record: GrowthRecord, current_year_id: UUID, user_id: UUID, bindings: Sequence[Binding]
) -> bool:
    if record.academic_year_id != current_year_id:
        return False
    if has_role_in_class(bindings, record.class_id, {Role.homeroom_teacher}):
        return True
    return record.created_by_user_id == user_id and can(
        bindings, Perm.GROWTH_WRITE, Scope(class_id=record.class_id)
    )


def _out(
    record: GrowthRecord,
    year_name: str,
    class_name: str,
    author: str | None,
    current_year_id: UUID,
    user_id: UUID,
    bindings: Sequence[Binding],
) -> GrowthRecordOut:
    return GrowthRecordOut(
        id=record.id,
        type=record.type,  # type: ignore[arg-type]
        date=record.date,
        content=record.content,
        academic_year_name=year_name,
        class_name=class_name,
        current_year=record.academic_year_id == current_year_id,
        created_by_name=author,
        can_delete=can_delete_record(record, current_year_id, user_id, bindings),
        created_at=record.created_at,
    )


def list_records(
    db: Session,
    student_id: UUID,
    current_year_id: UUID,
    user_id: UUID,
    bindings: Sequence[Binding],
) -> list[GrowthRecordOut]:
    rows = db.execute(
        select(GrowthRecord, AcademicYear.name, SchoolClass.name, User.display_name)
        .join(AcademicYear, AcademicYear.id == GrowthRecord.academic_year_id)
        .join(SchoolClass, SchoolClass.id == GrowthRecord.class_id)
        .outerjoin(User, User.id == GrowthRecord.created_by_user_id)
        .where(GrowthRecord.student_id == student_id)
        .order_by(GrowthRecord.date.desc(), GrowthRecord.created_at.desc())
    ).all()
    return [_out(r, y, c, a, current_year_id, user_id, bindings) for r, y, c, a in rows]


def one_out(
    db: Session,
    record: GrowthRecord,
    current_year_id: UUID,
    user_id: UUID,
    bindings: Sequence[Binding],
) -> GrowthRecordOut:
    year_name = db.scalars(
        select(AcademicYear.name).where(AcademicYear.id == record.academic_year_id)
    ).one()
    class_name = db.scalars(select(SchoolClass.name).where(SchoolClass.id == record.class_id)).one()
    author = db.scalars(
        select(User.display_name).where(User.id == record.created_by_user_id)
    ).first()
    return _out(record, year_name, class_name, author, current_year_id, user_id, bindings)


def create_record(
    db: Session, student_id: UUID, enrollment: Enrollment, user_id: UUID, data: GrowthInput
) -> GrowthRecord:
    record = GrowthRecord(
        student_id=student_id,
        enrollment_id=enrollment.id,
        class_id=enrollment.class_id,
        academic_year_id=enrollment.academic_year_id,
        type=data.type,
        date=data.date,
        content=data.content,
        created_by_user_id=user_id,
    )
    db.add(record)
    db.flush()
    db.refresh(record)
    return record
