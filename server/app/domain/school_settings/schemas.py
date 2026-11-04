from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field, field_validator

MAX_TAGS = 30


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


Tag = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=8)]


class TagPool(BaseModel):
    tags: list[str]


class TagRename(BaseModel):
    from_: Tag = Field(alias="from")
    to: Tag

    model_config = {"populate_by_name": True}


class TagPoolSave(BaseModel):
    tags: Annotated[list[Tag], Field(max_length=MAX_TAGS)]
    renames: list[TagRename] = []

    @field_validator("tags")
    @classmethod
    def _unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("标签不能重复")
        return value


class Switches(BaseModel):
    parent_rank: bool
    parent_negative_review: bool
    teacher_review_frequency: bool
    monitor: bool
    parent_monitor: bool
    ai_review_before_send: bool
    star_of_week: bool
    birthdays: bool
