from uuid import UUID

from pydantic import BaseModel, Field


class SeatIn(BaseModel):
    enrollment_id: UUID
    row: int = Field(ge=1)
    col: int = Field(ge=1)
    locked: bool


class SeatingSave(BaseModel):
    base_version: int = Field(ge=0)
    rows: int = Field(ge=1, le=12)
    cols: int = Field(ge=1, le=12)
    seats: list[SeatIn] = Field(max_length=144)


class SeatingSaved(BaseModel):
    version: int
    rows: int
    cols: int
