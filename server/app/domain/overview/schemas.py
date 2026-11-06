from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.domain.students.schemas import StudentSeat

AttendanceStatus = Literal["leave", "absent", "late"]


class Totals(BaseModel):
    students: int
    present: int
    leave: int
    absent: int
    late: int
    classes: int
    confirmed_classes: int


class Absentee(BaseModel):
    class_id: UUID
    class_name: str
    student_id: UUID
    name: str
    status: Literal["leave", "absent"]
    reason: str | None


class Unconfirmed(BaseModel):
    class_id: UUID
    class_name: str
    homeroom_name: str | None


class ClassWeek(BaseModel):
    class_id: UUID
    class_name: str
    plus: int
    minus: int
    net: int


class BottomStudent(BaseModel):
    class_id: UUID
    class_name: str
    student_id: UUID
    name: str
    net: int


class TeacherCount(BaseModel):
    user_id: UUID
    display_name: str
    count: int


class WeekReviews(BaseModel):
    classes: list[ClassWeek]
    bottom: list[BottomStudent]
    teachers: list[TeacherCount]


class GradeExamCard(BaseModel):
    id: UUID
    name: str
    grade_name: str
    entered: int
    expected: int


class MyNotice(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    recipients: int
    read: int


class TodayView(BaseModel):
    date: str
    scope_label: str
    totals: Totals
    absentees: list[Absentee]
    unconfirmed: list[Unconfirmed]
    week_reviews: WeekReviews
    grade_exam: GradeExamCard | None = None
    my_notices: list[MyNotice] = []


class GradeBrief(BaseModel):
    id: UUID
    name: str


class BoardMetrics(BaseModel):
    students: int
    present: int
    leave: int
    absent: int
    late: int
    confirmed: bool
    week_net: int


class BoardClass(BaseModel):
    id: UUID
    name: str
    room: str
    homeroom_name: str | None
    seat_rows: int
    seat_cols: int
    desk_size: Literal[1, 2, 3]
    podium_left: int
    podium_right: int
    seats: list[StudentSeat]
    attendance: dict[str, AttendanceStatus]
    metrics: BoardMetrics
    cameras: int = 0


class BoardView(BaseModel):
    grades: list[GradeBrief]
    grade_id: UUID | None
    classes: list[BoardClass]


class DetailAbsentee(BaseModel):
    student_id: UUID
    name: str
    status: Literal["leave", "absent"]
    reason: str | None


class BoardClassDetail(BoardClass):
    absentees: list[DetailAbsentee]
