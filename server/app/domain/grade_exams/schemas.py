import datetime as dt
from uuid import UUID

from pydantic import BaseModel

from app.domain.exams.schemas import ExamInput, ExamType, SubjectFull


class GradeExamInput(ExamInput):
    grade_id: UUID


class GradeExamClass(BaseModel):
    class_id: UUID
    class_name: str
    exam_id: UUID
    entered: int  # 已录格数
    expected: int  # 在读人数 × 科目数


class MissingClass(BaseModel):
    class_id: UUID
    class_name: str


class GradeExamOut(BaseModel):
    id: UUID
    grade_id: UUID
    grade_name: str
    name: str
    exam_type: ExamType
    date: dt.date
    subjects: list[SubjectFull]
    classes: list[GradeExamClass]
    missing_classes: list[MissingClass]
