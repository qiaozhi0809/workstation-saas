from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints

CameraLocation = Literal["教室", "走廊", "操场", "食堂", "其他"]
CameraStatus = Literal["idle", "streaming", "error"]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
Credential = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class CameraInput(BaseModel):
    name: Name
    class_id: UUID | None
    location: CameraLocation
    rtsp_url: Annotated[str, StringConstraints(max_length=500)]
    # 省略 = 不改;null = 清除;值 = 设置(用 model_fields_set 区分)
    username: Credential | None = None
    password: Credential | None = None
    enabled: bool
    transcode: bool


class CameraOut(BaseModel):
    id: UUID
    name: str
    class_id: UUID | None
    class_name: str | None
    location: CameraLocation
    enabled: bool
    transcode: bool
    rtsp_url: str | None = None  # 只在 camera.manage 的接口里返回;不含用户名密码
    has_credentials: bool
    status: CameraStatus
    last_error: str | None


class CameraTestResult(BaseModel):
    ok: bool
    message: str
    preview_jpeg_base64: str | None = None


class CameraHealth(BaseModel):
    public_hosts: list[str]
