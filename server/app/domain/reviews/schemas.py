from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class ReviewOut(BaseModel):
    id: UUID
    op_id: UUID
    enrollment_id: UUID
    category: Literal["individual", "whole_class"]
    reason_text: str
    score_delta: int
    subject: str | None
    given_at: datetime
    given_by_me: bool
    student_name: str
    transferred: bool


class ReviewCreate(BaseModel):
    op_id: UUID
    category: Literal["individual", "whole_class"]
    enrollment_ids: list[UUID] | None = None
    reason_text: str
    score_delta: int = Field(ge=-10, le=10)
    subject: str | None = None

    @field_validator("reason_text")
    @classmethod
    def _reason(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 20:
            raise ValueError("点评理由需为 1–20 字")
        return v

    @field_validator("score_delta")
    @classmethod
    def _delta(cls, v: int) -> int:
        if v == 0:
            raise ValueError("分值不能为 0")
        return v

    @field_validator("subject")
    @classmethod
    def _subject(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None

    @model_validator(mode="after")
    def _targets(self) -> Self:
        ids = self.enrollment_ids
        if self.category == "individual":
            if ids is None or not 1 <= len(ids) <= 80 or len(set(ids)) != len(ids):
                raise ValueError("individual 需要 1–80 个不重复的 enrollment_ids")
        elif ids is not None:
            raise ValueError("whole_class 不得带 enrollment_ids")
        return self


class ReviewCreated(BaseModel):
    items: list[ReviewOut]


class ReviewPage(BaseModel):
    items: list[ReviewOut]
    next_cursor: str | None


class ReviewTotals(BaseModel):
    enrollment_id: UUID
    total: int
    week: int
    plus_count: int
    minus_count: int


class ReviewSummary(BaseModel):
    week_start: date
    items: list[ReviewTotals]


class RevokeResult(BaseModel):
    op_id: UUID
    revoked: int
