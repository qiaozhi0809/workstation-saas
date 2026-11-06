from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

Stage = Literal["小学", "初中", "高中"]
StaffIdentity = Literal["homeroom", "assistant", "subject"]
AdminRoleType = Literal["principal", "dean", "grade_head", "it_admin"]


class SchoolInfo(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    address: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None


class YearAdmin(BaseModel):
    id: UUID
    name: str
    start_date: date
    end_date: date
    term2_start: date | None
    is_active: bool


class YearUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    start_date: date
    end_date: date
    term2_start: date | None = None


class GradeAdmin(BaseModel):
    id: UUID
    name: str
    stage: Stage | None
    effective_stage: Stage
    display_order: int
    class_count: int


class GradeInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    stage: Stage | None = None
    display_order: Annotated[int, Field(ge=0, le=99)]


class StaffBrief(BaseModel):
    assignment_id: UUID
    user_id: UUID
    teacher_id: UUID  # teachers.id:课表格子与升级向导按它比对在任老师(L55 / L209)
    display_name: str


class SubjectTeachers(BaseModel):
    subject: str
    teachers: list[StaffBrief]


class ClassAdmin(BaseModel):
    id: UUID
    name: str
    grade_id: UUID
    grade_name: str
    room: str
    student_count: int
    homeroom: StaffBrief | None
    assistants: list[StaffBrief]
    subjects: list[SubjectTeachers]
    desk_size: Literal[1, 2, 3]
    seat_layout: Literal["auto", "manual"]
    seat_rows: int
    seat_cols: int
    podium_left: int
    podium_right: int


class ClassInput(BaseModel):
    grade_id: UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    room: Annotated[str, StringConstraints(strip_whitespace=True, max_length=30)] = ""


class StaffInput(BaseModel):
    user_id: UUID
    identity: StaffIdentity
    subject: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None


class AdminRole(BaseModel):
    binding_id: UUID
    user_id: UUID
    display_name: str
    role: AdminRoleType
    grade_id: UUID | None
    grade_name: str | None


class AdminRoleInput(BaseModel):
    user_id: UUID
    role: AdminRoleType
    grade_id: UUID | None = None


class PersonBrief(BaseModel):
    user_id: UUID
    teacher_id: UUID  # 升级向导方案里的班主任是 teachers.id(L55)
    name: str
    login_name: str
    subjects: list[str]
