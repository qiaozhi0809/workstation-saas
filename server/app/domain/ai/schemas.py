"""AI 助手的请求与响应模型。"""

from pydantic import BaseModel


class AiStatus(BaseModel):
    configured: bool
    provider_label: str | None
    mask_forced: bool
