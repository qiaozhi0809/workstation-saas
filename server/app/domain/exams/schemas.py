from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

ExamType = Literal["月考", "期中", "期末", "周测", "单元测", "模拟考", "其他"]


class SubjectFull(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    full: Annotated[int, Field(ge=1, le=1000)]
