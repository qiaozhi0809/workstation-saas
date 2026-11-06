from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

# 身份语境,与 auth/service.py::contexts_of 的取值一致
Context = Literal["teacher", "parent", "admin"]


class ReviewReason(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: Annotated[str, Field(min_length=1, max_length=20)]
    delta: Annotated[int, Field(ge=-10, le=10)]

    @field_validator("delta")
    @classmethod
    def _non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta must not be 0")
        return value


class Preferences(BaseModel):
    teacher_figure: Literal["female", "male"]
    idle_animation: bool
    review_reasons: Annotated[list[ReviewReason], Field(min_length=1, max_length=20)]
    # 各语境首次引导完成的时间(R7)。GET 总是给完整对象(没看过的语境没有键);
    # PUT 里不带 / null = 不动,给了就按键合并进去,键只能是调用者自己拥有的语境;时间必须带时区
    onboarded: dict[Context, AwareDatetime] | None = None
