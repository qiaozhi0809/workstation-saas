"""AI 助手的请求与响应模型。"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField


class AiStatus(BaseModel):
    configured: bool
    provider_label: str | None
    mask_forced: bool


class AiField(BaseModel):
    key: str
    type: Literal["text", "textarea", "select", "check", "student", "students", "exam", "exam0"]
    label: str
    required: bool
    options: list[str] | None = None
    default: str | bool | None = None
    placeholder: str | None = None


class AiCategory(BaseModel):
    id: Literal["rec", "teach", "manage", "home", "grow"]
    label: str


class AiTemplate(BaseModel):
    id: str
    cat: Literal["teach", "manage", "home", "grow"]
    title: str
    desc: str
    rec: bool
    hidden: bool
    batch: bool
    fields: list[AiField]
    available: bool
    unavailable_reason: str | None


class AiTemplates(BaseModel):
    categories: list[AiCategory]
    items: list[AiTemplate]


class AiContextIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_: bool = PField(default=False, alias="class")
    student_id: UUID | None = None
    exam_id: UUID | None = None


class AiRequestIn(BaseModel):
    class_id: UUID
    template_id: str | None = None
    values: dict[str, Any] = PField(default_factory=dict)
    text: str | None = None
    context: AiContextIn | None = None
    mask: bool = False


class AiMapping(BaseModel):
    code: str
    name: str


class AiPrompt(BaseModel):
    prompt: str
    mapping: list[AiMapping]
