import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class Parent(Base):
    __tablename__ = "parents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    name: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    wechat_openid: Mapped[str | None] = mapped_column(Text)
    occupation: Mapped[str | None] = mapped_column(Text)
    relation_hint: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(**_NOW)
    updated_at: Mapped[datetime] = mapped_column(**_NOW)


class ParentLink(Base):
    __tablename__ = "parent_links"
    __table_args__ = (
        UniqueConstraint("parent_id", "student_id", name="parent_links_parent_id_student_id_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    parent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    relation: Mapped[str | None] = mapped_column(Text)
    is_primary: Mapped[bool] = mapped_column(server_default=text("false"))
    notify_enabled: Mapped[bool] = mapped_column(server_default=text("true"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    readonly_since: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(**_NOW)
