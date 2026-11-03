"""AI 助手的请求与响应模型。"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator
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


class AiReplyIn(BaseModel):
    text: str | None = None
    regenerate: bool = False

    @field_validator("text")
    @classmethod
    def _strip_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not 1 <= len(v) <= 4000:
            raise ValueError("追问需为 1–4000 字")
        return v


class AiMessageOut(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    status: Literal["streaming", "done", "error", "stopped"]
    error: str | None
    created_at: datetime


class AiBatchItemOut(BaseModel):
    id: UUID
    student_id: UUID
    student_name: str
    note: str | None
    status: Literal["wait", "run", "done", "err"]
    content: str
    error: str | None


class AiChatSummaryOut(BaseModel):
    id: UUID
    title: str
    template_id: str | None
    updated_at: datetime


class AiChatOut(AiChatSummaryOut):
    class_id: UUID
    student_id: UUID | None
    save_as: Literal["comment"] | None
    mask: bool
    batch_only: bool
    messages: list[AiMessageOut]
    items: list[AiBatchItemOut]


class AiChatList(BaseModel):
    items: list[AiChatSummaryOut]
