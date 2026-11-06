from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

from app.domain.exams.schemas import SubjectFull

MAX_TAGS = 30


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


Tag = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=8)]


class TagPool(BaseModel):
    tags: list[str]


class TagRename(BaseModel):
    from_: Tag = Field(alias="from")
    to: Tag

    model_config = {"populate_by_name": True}


class TagPoolSave(BaseModel):
    tags: Annotated[list[Tag], Field(max_length=MAX_TAGS)]
    renames: list[TagRename] = []

    @field_validator("tags")
    @classmethod
    def _unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("标签不能重复")
        return value


class Switches(BaseModel):
    parent_rank: bool
    parent_negative_review: bool
    teacher_review_frequency: bool
    monitor: bool
    parent_monitor: bool
    ai_review_before_send: bool
    star_of_week: bool
    birthdays: bool


class SecuritySettings(BaseModel):
    totp_allowed: bool
    password_min_length: Annotated[int, Field(ge=8, le=32)]
    password_max_age_days: Literal[0, 90, 180, 365]


class Grading(BaseModel):
    """及格 / 优秀比例:判定"≥ 满分 × 比例",两位小数,优秀线必须高于及格线。"""

    pass_ratio: Annotated[float, Field(ge=0.30, le=0.95)]
    good_ratio: Annotated[float, Field(ge=0.40, le=1.00)]

    @field_validator("pass_ratio", "good_ratio")
    @classmethod
    def _two_decimals(cls, value: float) -> float:
        if abs(value * 100 - round(value * 100)) > 1e-6:
            raise ValueError("比例最多两位小数")
        return round(value, 2)

    @model_validator(mode="after")
    def _good_above_pass(self) -> "Grading":
        if self.good_ratio <= self.pass_ratio:
            raise ValueError("优秀线必须高于及格线")
        return self


StageSubjects = Annotated[list[SubjectFull], Field(min_length=1, max_length=20)]


class SubjectCatalog(BaseModel):
    """各学段的科目目录(小学 / 初中 / 高中),每学段 1–20 门,科目名不重复。"""

    primary: StageSubjects
    junior: StageSubjects
    senior: StageSubjects

    @field_validator("primary", "junior", "senior")
    @classmethod
    def _unique(cls, value: list[SubjectFull]) -> list[SubjectFull]:
        names = [s.name for s in value]
        if len(set(names)) != len(names):
            raise ValueError("科目名不能重复")
        return value
