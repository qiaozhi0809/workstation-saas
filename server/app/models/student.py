import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class Student(Base):
    __tablename__ = "students"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    mk: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    gender: Mapped[str | None] = mapped_column(Text)
    student_no: Mapped[str | None] = mapped_column(Text)
    birthdate: Mapped[date | None]
    avatar_seed: Mapped[str | None] = mapped_column(Text)
    family_structure: Mapped[str | None] = mapped_column(Text)
    learning_summary: Mapped[str | None] = mapped_column(Text)
    personality: Mapped[str | None] = mapped_column(Text)
    health_notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    teacher_notes: Mapped[Any | None] = mapped_column(JSONB)
    boarding: Mapped[bool] = mapped_column(server_default=text("false"))
    family_note: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    contacts: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'"))
    mask_no: Mapped[int] = mapped_column(server_default=text("nextval('student_mask_no_seq')"))
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class Enrollment(Base):
    __tablename__ = "enrollments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("academic_years.id", ondelete="CASCADE")
    )
    seat_row: Mapped[int | None]
    seat_col: Mapped[int | None]
    class_role: Mapped[str | None] = mapped_column(Text)
    seat_locked: Mapped[bool] = mapped_column(server_default=text("false"))
    entered_at: Mapped[datetime] = mapped_column(**_NOW)
    left_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)
