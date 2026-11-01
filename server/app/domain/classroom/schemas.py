from datetime import date
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

Title = Annotated[str, Field(min_length=1, max_length=10)]
BoardText = Annotated[str, Field(max_length=120)]


class Board(BaseModel):
    left_title: Title = "今日课程"
    left_text: BoardText = ""
    right_title: Title = "今日事项"
    right_text: BoardText = ""
    countdown_label: Annotated[str, Field(max_length=12)] | None = None
    countdown_date: date | None = None

    @field_validator("left_text", "right_text")
    @classmethod
    def _max_four_lines(cls, value: str) -> str:
        if len(value.split("\n")) > 4:
            raise ValueError("文本最多 4 行")
        return value

    @model_validator(mode="after")
    def _countdown_pair(self) -> Self:
        if (self.countdown_label is None) != (self.countdown_date is None):
            raise ValueError("倒计时名称与日期必须同时填写或同时为空")
        return self


class YearInfo(BaseModel):
    id: UUID
    name: str
    start_date: date
    end_date: date


class ClassroomSummary(BaseModel):
    today: date
    timezone: str
    week_no: int
    week_start: date
    year: YearInfo
    seat_version: int
    my_perms: list[str]
    my_subjects: list[str]
    board: Board
