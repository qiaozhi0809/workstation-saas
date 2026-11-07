import datetime as dt
from uuid import UUID

from pydantic import BaseModel

from app.domain.exams.schemas import ExamType, SubjectFull


class HistoryYear(BaseModel):
    id: UUID
    name: str
    start_date: dt.date
    end_date: dt.date


class HistoryClass(BaseModel):
    class_id: UUID
    class_name: str
    grade_name: str
    homeroom_name: str | None
    students: int  # 该学年在这个班注册过的人数(含转出)


class HistoryClassLocation(BaseModel):
    """`GET /admin/history/classes/{class_id}`(L275):按班 id 定位它所在的学年,
    往年单班页不再逐年查找。"""

    class_id: UUID
    class_name: str
    year_id: UUID
    year_name: str


class HistoryStudent(BaseModel):
    student_id: UUID
    name: str
    student_no: str | None
    status: str  # enrollments.status 原值,前端映射中文


class HistoryRoster(BaseModel):
    students: list[HistoryStudent]


class HistoryExam(BaseModel):
    id: UUID
    name: str
    exam_type: ExamType
    date: dt.date
    subjects: list[SubjectFull]


class HistoryScoreRow(BaseModel):
    student_id: UUID
    name: str
    student_no: str | None
    scores: dict[str, float | None]
    total: float | None
    class_rank: int | None


class HistoryScores(BaseModel):
    exam: HistoryExam
    students: list[HistoryScoreRow]  # 按班级名次升序,没有名次的在后
