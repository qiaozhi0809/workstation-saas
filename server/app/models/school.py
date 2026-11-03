import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class School(Base):
    __tablename__ = "schools"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    name: Mapped[str] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text, server_default=text("'Asia/Shanghai'"))
    locale: Mapped[str] = mapped_column(Text, server_default=text("'zh-CN'"))
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class AcademicYear(Base):
    __tablename__ = "academic_years"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    start_date: Mapped[date]
    end_date: Mapped[date]
    is_active: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class Grade(Base):
    __tablename__ = "grades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("academic_years.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class SchoolClass(Base):
    __tablename__ = "classes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("academic_years.id", ondelete="CASCADE")
    )
    grade_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grades.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    seat_rows: Mapped[int] = mapped_column(server_default=text("7"))
    seat_cols: Mapped[int] = mapped_column(server_default=text("4"))
    seat_version: Mapped[int] = mapped_column(server_default=text("0"))
    desk_size: Mapped[int] = mapped_column(server_default=text("2"))
    seat_layout: Mapped[str] = mapped_column(server_default=text("'auto'"))
    seat_order: Mapped[str] = mapped_column(server_default=text("'row'"))
    podium_left: Mapped[int] = mapped_column(server_default=text("0"))
    podium_right: Mapped[int] = mapped_column(server_default=text("0"))
    room: Mapped[str] = mapped_column(server_default=text("''"))
    homeroom_teacher_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    subjects: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class SchoolSetting(Base):
    __tablename__ = "school_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(Text)
    value: Mapped[Any] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)
