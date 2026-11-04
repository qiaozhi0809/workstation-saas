from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

Content = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class CommentInput(BaseModel):
    content: Content
    generated_by_ai: bool


class CommentBulkItem(BaseModel):
    student_id: UUID
    content: Content


class CommentBulk(BaseModel):
    items: Annotated[list[CommentBulkItem], Field(min_length=1, max_length=80)]
    generated_by_ai: bool


class CommentBulkResult(BaseModel):
    created: int


class CommentOut(BaseModel):
    id: UUID
    semester: str
    content: str
    generated_by_ai: bool
    current_year: bool
    created_by_name: str | None
    can_delete: bool
    created_at: datetime
    parent_visible: bool


class ParentVisibleInput(BaseModel):
    visible: bool
