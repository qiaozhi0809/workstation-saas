import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

_UUID_PK = {"server_default": text("gen_random_uuid()")}
_NOW = {"server_default": text("now()")}


class YearUpgrade(Base):
    __tablename__ = "year_upgrades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, **_UUID_PK)
    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    from_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_years.id"))
    to_year_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("academic_years.id", ondelete="SET NULL")
    )
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB)
    executed_at: Mapped[datetime] = mapped_column(**_NOW)
    rolled_back_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(**_NOW)
