import datetime as dt
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

ExamType = Literal["月考", "期中", "期末", "周测", "单元测", "模拟考", "其他"]


class SubjectFull(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    full: Annotated[int, Field(ge=1, le=1000)]


class Progress(BaseModel):
    entered: int
    total: int


class ExamInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
    exam_type: ExamType
    date: dt.date
    subjects: Annotated[list[SubjectFull], Field(min_length=1, max_length=20)]

    @model_validator(mode="after")
    def _unique_subjects(self) -> "ExamInput":
        names = [s.name for s in self.subjects]
        if len(set(names)) != len(names):
            raise ValueError("subject names must be unique")
        return self


class ExamOut(BaseModel):
    id: UUID
    name: str
    exam_type: ExamType
    date: dt.date
    subjects: list[SubjectFull]
    created_by_me: bool
    progress: Progress
