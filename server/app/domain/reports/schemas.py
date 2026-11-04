import datetime as dt
from uuid import UUID

from pydantic import BaseModel

from app.domain.exams.schemas import SubjectFull


class SubjectStat(BaseModel):
    subject: str
    full: int
    count: int  # 有分数的人数
    missing: int  # 在读但没分(含缺考)
    avg: float | None
    max: float | None
    min: float | None
    pass_rate: float | None  # 0..1,阈值 60% / 85% 满分(同 M2b)
    good_rate: float | None


class TotalStat(BaseModel):
    full: int
    count: int
    avg: float | None
    max: float | None
    min: float | None


class GradeExamBrief(BaseModel):
    id: UUID
    name: str
    date: dt.date
    grade_name: str


class ClassScoreStat(BaseModel):
    class_id: UUID
    class_name: str
    subjects: list[SubjectStat]
    total: TotalStat


class GradeScoreStat(BaseModel):
    subjects: list[SubjectStat]
    total: TotalStat


class ScoreSummary(BaseModel):
    grade_exam: GradeExamBrief
    subjects: list[SubjectFull]
    classes: list[ClassScoreStat]  # 班名顺序,只含调用者可见的班
    grade: GradeScoreStat  # 可见班的合计


class ScoreStudentRow(BaseModel):
    student_id: UUID
    name: str
    student_no: str | None
    class_id: UUID
    class_name: str
    scores: dict[str, float | None]
    total: float | None
    class_rank: int | None
    grade_rank: int | None


class ScoreStudents(BaseModel):
    students: list[ScoreStudentRow]
