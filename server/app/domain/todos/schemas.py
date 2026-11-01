from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Content = Annotated[str, Field(min_length=1, max_length=200)]


class TodoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    content: str
    done: bool
    created_at: datetime


class TodoList(BaseModel):
    items: list[TodoOut]


class TodoCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: Content


class TodoPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: Content | None = None
    done: bool | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> Self:
        if "content" not in self.model_fields_set and "done" not in self.model_fields_set:
            raise ValueError("content or done is required")
        if self.content is None and "content" in self.model_fields_set:
            raise ValueError("content must not be null")
        if self.done is None and "done" in self.model_fields_set:
            raise ValueError("done must not be null")
        return self
