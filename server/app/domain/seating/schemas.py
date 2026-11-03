from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.domain.seating.arrange import cols_ok


class SeatIn(BaseModel):
    enrollment_id: UUID
    row: int = Field(ge=0)
    col: int = Field(ge=-2, le=12)
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


class LayoutDraft(BaseModel):
    desk_size: Literal[1, 2, 3]
    seat_layout: Literal["auto", "manual"]
    rows: int = Field(ge=1, le=12)
    cols: int | None = None
    podium_left: int = Field(ge=0, le=2)
    podium_right: int = Field(ge=0, le=2)
    how: Literal["keep", "row", "col"]

    @model_validator(mode="after")
    def _manual_cols(self) -> "LayoutDraft":
        if self.seat_layout == "manual" and not cols_ok(self.cols, self.desk_size):
            raise ValueError("每排座位数与每桌人数不匹配")
        return self


class LayoutSave(LayoutDraft):
    base_version: int = Field(ge=0)
    room: Annotated[str, StringConstraints(strip_whitespace=True, max_length=30)]


class PreviewSeat(BaseModel):
    enrollment_id: UUID
    row: int
    col: int


class LayoutPreview(BaseModel):
    rows: int
    cols: int
    seats: list[PreviewSeat]
    capacity: int
    students: int
    unseated: int


class LayoutSaved(BaseModel):
    version: int
    moved: bool
    rows: int
    cols: int
