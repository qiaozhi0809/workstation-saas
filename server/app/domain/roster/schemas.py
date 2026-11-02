from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.domain.students.schemas import Contact, StudentSeat, TeacherNote

__all__ = ["Contact", "SeatPos", "StudentInput", "StudentRecord", "TeacherNote"]


def _nullable(value: str | None, limit: int, label: str) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > limit:
        raise ValueError(f"{label}最多 {limit} 个字")
    return value


class SeatPos(BaseModel):
    row: int = Field(ge=1)
    col: int = Field(ge=1)


class StudentInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    gender: Literal["男", "女"] | None
    student_no: str | None
    birthdate: date | None
    class_role: str | None
    tags: list[str]
    boarding: bool
    family_structure: str | None
    family_note: str | None
    learning_summary: str | None
    personality: str | None
    note: str | None
    health_notes: str | None
    contacts: Annotated[list[Contact], Field(max_length=2)]
    seat: SeatPos | None

    @field_validator("student_no")
    @classmethod
    def _student_no(cls, value: str | None) -> str | None:
        return _nullable(value, 20, "学号")

    @field_validator("class_role")
    @classmethod
    def _class_role(cls, value: str | None) -> str | None:
        return _nullable(value, 10, "职务")

    @field_validator("family_structure")
    @classmethod
    def _family_structure(cls, value: str | None) -> str | None:
        return _nullable(value, 10, "家庭结构")

    @field_validator("family_note", "learning_summary", "personality", "note")
    @classmethod
    def _long_text(cls, value: str | None) -> str | None:
        return _nullable(value, 500, "文字")

    @field_validator("health_notes")
    @classmethod
    def _health(cls, value: str | None) -> str | None:
        return _nullable(value, 300, "健康备注")

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for raw in value:
            tag = raw.strip()
            if not 1 <= len(tag) <= 10:
                raise ValueError("标签需为 1–10 个字")
            seen.setdefault(tag)
        if len(seen) > 12:
            raise ValueError("标签最多 12 个")
        return list(seen)


class StudentRecord(StudentSeat):
    boarding: bool | None = None
    family_structure: str | None = None
    family_note: str | None = None
    contacts: list[Contact] | None = None
    learning_summary: str | None = None
    personality: str | None = None
    health_notes: str | None = None
    tags: list[str] | None = None
    note: str | None = None
