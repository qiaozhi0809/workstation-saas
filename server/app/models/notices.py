import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class Notice(Base):
    __tablename__ = "notices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    target: Mapped[dict[str, Any]] = mapped_column(JSONB)
    target_label: Mapped[str] = mapped_column(Text)
    require_ack: Mapped[bool] = mapped_column(server_default=text("false"))
    audience: Mapped[str] = mapped_column(Text, server_default=text("'teachers'"))
    ack_kind: Mapped[str] = mapped_column(Text, server_default=text("'none'"))
    ack_options: Mapped[list[str] | None] = mapped_column(JSONB)
    ack_allow_note: Mapped[bool] = mapped_column(server_default=text("false"))
    ack_deadline: Mapped[datetime | None]
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("classes.id", ondelete="SET NULL")
    )
    students_without_parent: Mapped[int] = mapped_column(server_default=text("0"))
    recalled_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(**_NOW)


class NoticeRecipient(Base):
    __tablename__ = "notice_recipients"

    notice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notices.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    read_at: Mapped[datetime | None]
    acked_at: Mapped[datetime | None]
    ack_content: Mapped[str | None] = mapped_column(Text)
    ack_choice: Mapped[int | None] = mapped_column(SmallInteger)


class NoticeStudent(Base):
    __tablename__ = "notice_students"

    notice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notices.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), primary_key=True
    )
    parent_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
