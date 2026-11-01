from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class StudentSeat(BaseModel):
    enrollment_id: UUID
    student_id: UUID
    name: str
    mk: str
    seat_row: int | None
    seat_col: int | None
    avatar_seed: str | None
    gender: str | None
    student_no: str | None
    birthdate: date | None
    class_role: str | None
    seat_locked: bool


class StudentProfile(BaseModel):
    id: UUID
    enrollment_id: UUID
    mk: str
    name: str
    class_id: UUID
    gender: str | None = None
    student_no: str | None = None
    birthdate: date | None = None
    avatar_seed: str | None = None
    class_role: str | None = None
    family_structure: str | None = None
    learning_summary: str | None = None
    personality: str | None = None
    health_notes: str | None = None
    tags: list[str] | None = None
    teacher_notes: Any = None
