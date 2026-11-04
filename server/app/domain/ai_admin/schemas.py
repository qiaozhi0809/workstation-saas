from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field, field_validator


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class AiTemplateCount(BaseModel):
    template: str
    label: str
    count: int


class AiUsageRow(BaseModel):
    user_id: str
    display_name: str
    calls: int
    failed: int
    prompt_tokens: int
    completion_tokens: int
    top_templates: list[AiTemplateCount]


class AiUsageTotal(BaseModel):
    calls: int
    failed: int
    prompt_tokens: int
    completion_tokens: int


class AiUsage(BaseModel):
    month: str
    rows: list[AiUsageRow]
    total: AiUsageTotal


class AiProviderOption(BaseModel):
    id: str
    label: str
    base_url: str
    models: list[str]


class AiConfigView(BaseModel):
    provider: str | None
    base_url: str | None
    model: str | None
    temperature: float | None
    mask_forced: bool
    key_set: bool
    key_undecryptable: bool
    providers: list[AiProviderOption]


class AiConfigSave(BaseModel):
    provider: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=40)]
    base_url: Annotated[str, BeforeValidator(_strip), Field(max_length=500)]
    model: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=200)]
    temperature: Annotated[float, Field(ge=0, le=2)]
    mask_forced: bool
    api_key: str | None = None

    @field_validator("base_url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        if not v.lower().startswith(("http://", "https://")) or len(v.split("://", 1)[1]) == 0:
            raise ValueError("base_url 必须以 http:// 或 https:// 开头")
        return v

    @field_validator("api_key")
    @classmethod
    def _clean_key(cls, v: str | None) -> str | None:
        v = v.strip() if v is not None else None
        if v and len(v) > 500:
            raise ValueError("api_key 过长")
        return v or None


class AiTestResult(BaseModel):
    ok: bool
    message: str
