from datetime import date
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

Title = Annotated[str, Field(min_length=1, max_length=10)]
BoardText = Annotated[str, Field(max_length=120)]


class Board(BaseModel):
    left_title: Title
    left_text: BoardText
    right_title: Title
    right_text: BoardText
    countdown_label: Annotated[str, Field(max_length=12)] | None
    countdown_date: date | None

    @field_validator("left_title", "right_title", mode="before")
    @classmethod
    def _strip_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("countdown_label", mode="before")
    @classmethod
    def _strip_label(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

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


class ClassRoleUpdate(BaseModel):
    class_role: str | None

    @field_validator("class_role")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if len(value) > 10:
            raise ValueError("职务最多 10 个字")
        return value


class ClassRoleUpdated(BaseModel):
    enrollment_id: UUID
    class_role: str | None


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
