import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class Attendance(Base):
    __tablename__ = "attendances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("enrollments.id", ondelete="CASCADE")
    )
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    date: Mapped[date]
    status: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    marked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    marked_at: Mapped[datetime] = mapped_column(**_NOW)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class AttendanceDay(Base):
    __tablename__ = "attendance_days"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    date: Mapped[date]
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    confirmed_at: Mapped[datetime] = mapped_column(**_NOW)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    op_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("enrollments.id", ondelete="CASCADE")
    )
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(Text)
    reason_text: Mapped[str] = mapped_column(Text)
    score_delta: Mapped[int]
    subject: Mapped[str | None] = mapped_column(Text)
    given_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    given_at: Mapped[datetime] = mapped_column(**_NOW)
    revoked_at: Mapped[datetime | None]
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class SeatArrangement(Base):
    __tablename__ = "seat_arrangements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    version: Mapped[int]
    seat_rows: Mapped[int]
    seat_cols: Mapped[int]
    layout: Mapped[Any] = mapped_column(JSONB)
    saved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    saved_at: Mapped[datetime] = mapped_column(**_NOW)


class ClassBoard(Base):
    __tablename__ = "class_boards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    left_title: Mapped[str] = mapped_column(Text, server_default=text("'今日课程'"))
    left_text: Mapped[str] = mapped_column(Text, server_default=text("''"))
    right_title: Mapped[str] = mapped_column(Text, server_default=text("'今日事项'"))
    right_text: Mapped[str] = mapped_column(Text, server_default=text("''"))
    countdown_label: Mapped[str | None] = mapped_column(Text)
    countdown_date: Mapped[date | None]
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(server_default=text("false"))
    due_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    teacher_figure: Mapped[str] = mapped_column(Text, server_default=text("'female'"))
    idle_animation: Mapped[bool] = mapped_column(server_default=text("true"))
    review_reasons: Mapped[Any | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)
