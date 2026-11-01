from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReviewReason(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: Annotated[str, Field(min_length=1, max_length=20)]
    delta: Annotated[int, Field(ge=-10, le=10)]

    @field_validator("delta")
    @classmethod
    def _non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta must not be 0")
        return value


class Preferences(BaseModel):
    teacher_figure: Literal["female", "male"]
    idle_animation: bool
    review_reasons: Annotated[list[ReviewReason], Field(min_length=1, max_length=20)]
