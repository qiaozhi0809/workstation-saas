from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints

GrowthType = Literal["表扬", "谈话", "家访", "获奖", "提醒", "其他"]


class GrowthInput(BaseModel):
    type: GrowthType
    date: date
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class GrowthRecordOut(BaseModel):
    id: UUID
    type: GrowthType
    date: date
    content: str
    academic_year_name: str
    class_name: str
    current_year: bool
    created_by_name: str | None
    can_delete: bool
    created_at: datetime
