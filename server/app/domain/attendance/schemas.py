from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ExceptionStatus = Literal["leave", "absent", "late"]


class AttendanceRecord(BaseModel):
    enrollment_id: UUID
    status: ExceptionStatus
    reason: str | None
    marked_at: datetime


class AttendanceDay(BaseModel):
    date: date
    confirmed_at: datetime | None
    items: list[AttendanceRecord]


class AttendanceUpdate(BaseModel):
    status: ExceptionStatus | Literal["present"]
    reason: Annotated[str, Field(max_length=100)] | None = None

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class AttendanceUpdated(BaseModel):
    enrollment_id: UUID
    status: ExceptionStatus | Literal["present"]
    reason: str | None


class ConfirmRequest(BaseModel):
    clear_exceptions: bool


class MonthItem(BaseModel):
    enrollment_id: UUID
    date: date
    status: ExceptionStatus


class AttendanceMonth(BaseModel):
    month: str
    items: list[MonthItem]
