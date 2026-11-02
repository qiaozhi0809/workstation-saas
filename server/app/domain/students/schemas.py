from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator


def _strip_max(value: str, limit: int, label: str) -> str:
    value = value.strip()
    if len(value) > limit:
        raise ValueError(f"{label}最多 {limit} 个字")
    return value


class Contact(BaseModel):
    name: str
    relation: str
    phone: str
    job: str

    @field_validator("name", "phone", "job")
    @classmethod
    def _strip_20(cls, value: str) -> str:
        return _strip_max(value, 20, "联系人信息")

    @field_validator("relation")
    @classmethod
    def _strip_10(cls, value: str) -> str:
        return _strip_max(value, 10, "关系")

    @model_validator(mode="after")
    def _name_or_phone(self) -> "Contact":
        if not self.name and not self.phone:
            raise ValueError("联系人姓名和电话不能同时为空")
        return self


class TeacherNote(BaseModel):
    text: str
    updated_at: datetime


class StudentSeat(BaseModel):
    enrollment_id: UUID
    student_id: UUID
    name: str
    mk: str
    seat_row: int | None
    seat_col: int | None
    avatar_seed: str | None
    gender: str | None
    student_no: str | None
    birthdate: date | None
    class_role: str | None
    seat_locked: bool


class StudentProfile(BaseModel):
    id: UUID
    enrollment_id: UUID
    mk: str
    name: str
    class_id: UUID
    gender: str | None = None
    student_no: str | None = None
    birthdate: date | None = None
    avatar_seed: str | None = None
    class_role: str | None = None
    family_structure: str | None = None
    learning_summary: str | None = None
    personality: str | None = None
    health_notes: str | None = None
    tags: list[str] | None = None
    boarding: bool | None = None
    family_note: str | None = None
    contacts: list[Contact] | None = None
    note: str | None = None
    teacher_notes: TeacherNote | None = None
