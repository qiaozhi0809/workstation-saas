import re
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_PERIOD_NO = 12

Weekday = Annotated[int, Field(ge=1, le=7)]
PeriodNo = Annotated[int, Field(ge=1, le=MAX_PERIOD_NO)]
Subject = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]


class Period(BaseModel):
    no: PeriodNo
    starts_at: Annotated[str, StringConstraints(pattern=HHMM.pattern)]
    ends_at: Annotated[str, StringConstraints(pattern=HHMM.pattern)]

    @model_validator(mode="after")
    def _ordered(self) -> "Period":
        if self.starts_at >= self.ends_at:
            raise ValueError("开始时间必须早于结束时间")
        return self


class PeriodsInput(BaseModel):
    periods: list[Period] = Field(max_length=MAX_PERIOD_NO)

    @model_validator(mode="after")
    def _no_overlap(self) -> "PeriodsInput":
        ordered = sorted(self.periods, key=lambda p: p.no)
        if len({p.no for p in ordered}) != len(ordered):
            raise ValueError("节次编号重复")
        for prev, cur in zip(ordered, ordered[1:], strict=False):
            if cur.starts_at < prev.ends_at:
                raise ValueError(f"第 {prev.no} 节与第 {cur.no} 节时间重叠")
        return self


class TeacherBrief(BaseModel):
    id: UUID
    name: str


class TimetableCell(BaseModel):
    weekday: Weekday
    period_no: int
    subject: str
    teacher: TeacherBrief | None


class ClassTimetable(BaseModel):
    class_id: UUID
    class_name: str
    cells: list[TimetableCell]


class CellInput(BaseModel):
    weekday: Weekday
    period_no: PeriodNo
    subject: Subject
    teacher_id: UUID | None = None


class TimetableInput(BaseModel):
    cells: list[CellInput] = Field(max_length=7 * MAX_PERIOD_NO)


class TimetableImportRow(BaseModel):
    line: int
    class_name: str
    weekday: int  # 无法识别时为 0,由 import_rows 报行错误
    period_no: int  # 无法识别时为 0
    subject: str
    employee_no: str | None


class ImportLineError(BaseModel):
    line: int
    message: str


class TimetableImportResult(BaseModel):
    ok: bool
    written: int
    errors: list[ImportLineError]
