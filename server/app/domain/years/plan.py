"""学年升级方案(命令行契约里的 JSON),pydantic 校验结构层面的约束。

`from_name` / `name` / `teacher_name` 只给人看,执行时忽略。
"""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class NewYear(BaseModel):
    name: str = Field(min_length=1)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _dates_in_order(self) -> "NewYear":
        if not self.start_date < self.end_date:
            raise ValueError("start_date 必须早于 end_date")
        return self


class ClassPlan(BaseModel):
    from_class_id: UUID
    from_name: str | None = None
    action: Literal["promote", "graduate"]
    to_grade_name: str | None = None
    to_name: str | None = None
    homeroom_teacher_id: UUID | None = None
    teacher_name: str | None = None
    keep_teachers: bool = True


class RepeatTarget(BaseModel):
    successor_of: UUID | None = None
    new_class: int | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "RepeatTarget":
        if (self.successor_of is None) == (self.new_class is None):
            raise ValueError("to 必须且只能给 successor_of 或 new_class 之一")
        return self


class StudentPlan(BaseModel):
    enrollment_id: UUID
    name: str | None = None
    action: Literal["repeat", "leave"]
    to: RepeatTarget | None = None

    @model_validator(mode="after")
    def _to_matches_action(self) -> "StudentPlan":
        if self.action == "repeat" and self.to is None:
            raise ValueError("repeat 必须给 to")
        if self.action == "leave" and self.to is not None:
            raise ValueError("leave 不能给 to")
        return self


class NewClassPlan(BaseModel):
    grade_name: str = Field(min_length=1)
    name: str = Field(min_length=1)
    homeroom_teacher_id: UUID | None = None
    seat_rows: int = Field(default=7, ge=1, le=12)
    seat_cols: int = 4
    desk_size: Literal[1, 2, 3] = 2
    seat_layout: Literal["auto", "manual"] = "auto"

    @model_validator(mode="after")
    def _cols_fit_desk(self) -> "NewClassPlan":
        # 单人桌 2..12;双人桌 2..12 且为偶数;三人桌 3..12 且为 3 的倍数
        low = 3 if self.desk_size == 3 else 2
        step = self.desk_size if self.desk_size > 1 else 1
        if not low <= self.seat_cols <= 12 or self.seat_cols % step != 0:
            raise ValueError("每排座位数不合规")
        return self


class GradeHeadPlan(BaseModel):
    """新学年某个年级的组长(账号);`grade_name` 是新学年的年级名。"""

    grade_name: str
    user_ids: list[UUID]


class UpgradePlan(BaseModel):
    version: Literal[1]
    from_year_id: UUID
    new_year: NewYear
    classes: list[ClassPlan]
    students: list[StudentPlan] = []
    new_classes: list[NewClassPlan] = []
    # None = 旧规则(组长跟届);数组 = 新学年每个年级的组长,未列出的年级没有组长
    grade_heads: list[GradeHeadPlan] | None = None
