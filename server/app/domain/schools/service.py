from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AcademicYear


def active_academic_year(db: Session, school_id: UUID) -> AcademicYear | None:
    return db.scalars(
        select(AcademicYear).where(
            AcademicYear.school_id == school_id, AcademicYear.is_active.is_(True)
        )
    ).first()
