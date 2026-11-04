from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator


class SchoolTarget(BaseModel):
    kind: Literal["school"]


class GradeTarget(BaseModel):
    kind: Literal["grade"]
    grade_id: UUID


class ClassTarget(BaseModel):
    kind: Literal["class"]
    class_id: UUID


class UsersTarget(BaseModel):
    kind: Literal["users"]
    user_ids: Annotated[list[UUID], Field(min_length=1, max_length=200)]

    @field_validator("user_ids")
    @classmethod
    def _dedupe(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


NoticeTarget = Annotated[
    SchoolTarget | GradeTarget | ClassTarget | UsersTarget, Field(discriminator="kind")
]


class NoticeInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    target: NoticeTarget


class NoticeSent(BaseModel):
    id: UUID
    title: str
    content: str
    target_label: str
    created_at: datetime
    recalled_at: datetime | None
    recipients: int
    read: int


class NoticeSentPage(BaseModel):
    items: list[NoticeSent]
    total: int


class NoticePerson(BaseModel):
    user_id: UUID
    name: str
    tags: list[str]


class ReadRecipient(BaseModel):
    user_id: UUID
    name: str
    read_at: datetime


class UnreadRecipient(BaseModel):
    user_id: UUID
    name: str


class NoticeRecipients(BaseModel):
    read: list[ReadRecipient]
    unread: list[UnreadRecipient]


class InboxItem(BaseModel):
    id: UUID
    title: str
    content: str | None
    from_name: str | None
    created_at: datetime
    read_at: datetime | None
    recalled: bool


class Inbox(BaseModel):
    items: list[InboxItem]
    total: int
    unread: int
