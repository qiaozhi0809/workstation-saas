import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}
_CLOCK = {"server_default": text("clock_timestamp()")}


class AiChat(Base):
    __tablename__ = "ai_chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    template_id: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL")
    )
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    save_as: Mapped[str | None] = mapped_column(Text)
    mask: Mapped[bool]
    batch_only: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(**_CLOCK)
    updated_at: Mapped[datetime] = mapped_column(**_CLOCK)


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, server_default=text("''"))
    sent: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'done'"))
    error: Mapped[str | None] = mapped_column(Text)
    prompt_tokens: Mapped[int | None]
    completion_tokens: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(**_CLOCK)
    updated_at: Mapped[datetime] = mapped_column(**_CLOCK)


class AiBatchItem(Base):
    __tablename__ = "ai_batch_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_chats.id", ondelete="CASCADE"))
    position: Mapped[int]
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("enrollments.id", ondelete="CASCADE")
    )
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'wait'"))
    content: Mapped[str] = mapped_column(Text, server_default=text("''"))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)
