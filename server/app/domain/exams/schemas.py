import datetime as dt
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

ExamType = Literal["月考", "期中", "期末", "周测", "单元测", "模拟考", "其他"]
Stage = Literal["primary", "junior", "senior"]


class SubjectFull(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    full: Annotated[int, Field(ge=1, le=1000)]


def _preset(names: list[str], full: int) -> list[SubjectFull]:
    return [SubjectFull(name=n, full=full) for n in names]


# 各学段内置科目预设(学校没存过目录时的默认值)。放在这个叶子模块里:school_settings.service
# 与 exams.subjects 都要用它,而 exams.subjects 又依赖 school_settings.service 读目录,
# 预设不能留在 exams.subjects,否则两边互相 import(L227)。
PRESETS: dict[Stage, list[SubjectFull]] = {
    "primary": _preset(["语文", "数学", "英语", "科学", "道法"], 100),
    "junior": _preset(["语文", "数学", "英语"], 120)
    + _preset(["物理", "化学", "道法", "历史", "地理", "生物"], 100),
    "senior": _preset(["语文", "数学", "英语"], 150)
    + _preset(["物理", "化学", "生物", "政治", "历史", "地理"], 100),
}


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
    grade_exam_id: UUID | None = None


ScoreValue = float | None


class ScoreSheetItem(BaseModel):
    enrollment_id: UUID
    scores: dict[str, ScoreValue]


class ScoreSheet(BaseModel):
    exam: ExamOut
    items: list[ScoreSheetItem]


class ScoreCellIn(BaseModel):
    enrollment_id: UUID
    subject: str
    value: Annotated[float, Field(strict=True)] | Literal["absent"] | None


class ScoresSave(BaseModel):
    cells: Annotated[list[ScoreCellIn], Field(min_length=1, max_length=2000)]


class ScoresSaved(BaseModel):
    updated: int


class GradebookExam(ExamOut):
    scores: dict[str, dict[str, ScoreValue]]


class Gradebook(BaseModel):
    exams: list[GradebookExam]
