import base64
import binascii
import json
import time
import uuid
from types import SimpleNamespace
from uuid import UUID

from fastapi import Request
from pydantic import ValidationError
from redis import Redis
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.audit.service import record
from app.config import Settings
from app.crypto import CryptoError, decrypt, encrypt
from app.domain.cameras.lan import mask_url, validate_rtsp_url
from app.domain.cameras.schemas import CameraInput, CameraOut, CameraTestResult
from app.domain.school_settings.service import get_switches
from app.errors import ApiError
from app.models import Grade, SchoolClass
from app.models.cameras import Camera

PROBE_TIMEOUT = 10.0  # R9:同步等待,占一个线程池线程;可注入
PROBE_INTERVAL = 0.2
NO_REPLY = "转流服务没有响应"
BAD_PREVIEW = "预览数据异常"
PREVIEW_LAN_ONLY = "预览图只在校园网内显示"
MAX_PREVIEW_BYTES = 1_000_000
JPEG_MAGIC = b"\xff\xd8\xff"

STATE_KEY = "ws:cam:state:{}"
PROBE_QUEUE = "ws:cam:probe"
PROBE_REPLY = "ws:cam:probe:reply:{}"
RELOAD_CHANNEL = "ws:cam:reload"
PUBLIC_HOSTS_KEY = "ws:cam:public_hosts"


def require_monitor(db: Session, school_id: UUID) -> None:
    if not get_switches(db, school_id).monitor:
        raise ApiError(404, "NOT_FOUND", "功能未开启")


def _aad(camera_id: UUID, field: str) -> str:
    return f"camera:{camera_id}:{field}"


def _enc(value: str, camera_id: UUID, field: str, settings: Settings) -> str:
    return encrypt(value, settings.master_key_bytes, aad=_aad(camera_id, field))


def _same_secret(
    token: str | None, value: str | None, camera_id: UUID, field: str, key: bytes
) -> bool:
    if token is None or value is None:
        return token is None and value is None
    try:
        return decrypt(token, key, aad=_aad(camera_id, field)) == value
    except CryptoError:
        return False


def _state(redis: Redis, camera_id: UUID) -> tuple[str, str | None]:
    data = redis.hgetall(STATE_KEY.format(camera_id)) or {}
    status = data.get("status")
    if status not in ("idle", "streaming", "error"):
        status = "idle"
    err = data.get("last_error") or None
    return status, (mask_url(err) if err else None)


def camera_out(
    camera: Camera, state: tuple[str, str | None], *, include_url: bool, class_name: str | None
) -> CameraOut:
    status, last_error = state
    return CameraOut(
        id=camera.id,
        name=camera.name,
        class_id=camera.class_id,
        class_name=class_name,
        location=camera.location,
        enabled=camera.enabled,
        transcode=camera.transcode,
        rtsp_url=mask_url(camera.rtsp_url) if include_url else None,
        has_credentials=camera.rtsp_username is not None or camera.rtsp_password is not None,
        status=status,
        last_error=last_error,
    )


def _class_name(db: Session, class_id: UUID | None) -> str | None:
    if class_id is None:
        return None
    return db.scalar(select(SchoolClass.name).where(SchoolClass.id == class_id))


def _out(db: Session, redis: Redis, camera: Camera) -> CameraOut:
    return camera_out(
        camera,
        _state(redis, camera.id),
        include_url=True,
        class_name=_class_name(db, camera.class_id),
    )


def list_cameras(db: Session, redis: Redis, school_id: UUID) -> list[CameraOut]:
    rows = db.execute(
        select(Camera, SchoolClass.name)
        .outerjoin(SchoolClass, SchoolClass.id == Camera.class_id)
        .outerjoin(Grade, Grade.id == SchoolClass.grade_id)
        .where(Camera.school_id == school_id)
        .order_by(
            Camera.class_id.is_(None),
            Grade.display_order,
            Grade.name,
            SchoolClass.name,
            Camera.name,
            Camera.id,
        )
    ).all()
    return [
        camera_out(c, _state(redis, c.id), include_url=True, class_name=name) for c, name in rows
    ]


def get_camera(db: Session, school_id: UUID, camera_id: UUID) -> Camera:
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.school_id == school_id))
    if camera is None:
        raise ApiError(404, "NOT_FOUND", "摄像头不存在")
    return camera


def _check_class(db: Session, school_id: UUID, class_id: UUID | None) -> None:
    if class_id is None:
        return
    ok = db.scalar(
        select(func.count())
        .select_from(SchoolClass)
        .where(SchoolClass.id == class_id, SchoolClass.school_id == school_id)
    )
    if not ok:
        raise ApiError(404, "NOT_FOUND", "班级不存在")


def _url(data: CameraInput, settings: Settings) -> str:
    return validate_rtsp_url(data.rtsp_url, allow_loopback=settings.env == "dev")


def _audit(db, request, user_id, action, camera: Camera) -> None:
    record(
        db,
        user_id=user_id,
        action=action,
        success=True,
        object_type="camera",
        object_id=str(camera.id),
        request=request,
        extra={"name": camera.name},
    )


def create_camera(
    db: Session,
    redis: Redis,
    settings: Settings,
    school_id: UUID,
    user_id: UUID,
    data: CameraInput,
    request: Request | None,
) -> CameraOut:
    url = _url(data, settings)
    _check_class(db, school_id, data.class_id)
    camera_id = uuid.uuid4()  # 先有 id,密文才能绑定 aad
    camera = Camera(
        id=camera_id,
        school_id=school_id,
        name=data.name,
        class_id=data.class_id,
        location=data.location,
        rtsp_url=url,
        rtsp_username=(
            _enc(data.username, camera_id, "username", settings) if data.username else None
        ),
        rtsp_password=(
            _enc(data.password, camera_id, "password", settings) if data.password else None
        ),
        enabled=data.enabled,
        transcode=data.transcode,
    )
    db.add(camera)
    db.flush()
    _audit(db, request, user_id, "camera.create", camera)
    db.commit()
    db.refresh(camera)
    return _out(db, redis, camera)


def update_camera(
    db: Session,
    redis: Redis,
    settings: Settings,
    school_id: UUID,
    user_id: UUID,
    camera_id: UUID,
    data: CameraInput,
    request: Request | None,
) -> CameraOut:
    url = _url(data, settings)
    camera = get_camera(db, school_id, camera_id)
    _check_class(db, school_id, data.class_id)
    key = settings.master_key_bytes
    changed = (
        url != camera.rtsp_url
        or data.enabled != camera.enabled
        or data.transcode != camera.transcode
    )
    for field, attr in (("username", "rtsp_username"), ("password", "rtsp_password")):
        if field not in data.model_fields_set:
            continue
        value = getattr(data, field)
        if not _same_secret(getattr(camera, attr), value, camera.id, field, key):
            changed = True
            setattr(camera, attr, _enc(value, camera.id, field, settings) if value else None)
    camera.name = data.name
    camera.class_id = data.class_id
    camera.location = data.location
    camera.rtsp_url = url
    camera.enabled = data.enabled
    camera.transcode = data.transcode
    camera.updated_at = func.now()
    db.flush()
    _audit(db, request, user_id, "camera.update", camera)
    db.commit()
    db.refresh(camera)
    if changed:
        redis.publish(RELOAD_CHANNEL, str(camera.id))
    return _out(db, redis, camera)


def delete_camera(
    db: Session,
    redis: Redis,
    school_id: UUID,
    user_id: UUID,
    camera_id: UUID,
    request: Request | None,
) -> None:
    camera = get_camera(db, school_id, camera_id)
    _audit(db, request, user_id, "camera.delete", camera)
    db.execute(delete(Camera).where(Camera.id == camera.id))
    db.commit()
    redis.publish(RELOAD_CHANNEL, str(camera_id))


def _checked(result: CameraTestResult) -> CameraTestResult:
    """Redis 里的预览不可信:限大小、必须是 JPEG,否则丢弃。"""
    b64 = result.preview_jpeg_base64
    if b64 is None:
        return result
    bad = CameraTestResult(ok=False, message=BAD_PREVIEW, preview_jpeg_base64=None)
    if len(b64) > MAX_PREVIEW_BYTES * 4 // 3 + 4:
        return bad
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return bad
    if len(data) > MAX_PREVIEW_BYTES or not data.startswith(JPEG_MAGIC):
        return bad
    return result


def test_camera(
    db: Session,
    redis: Redis,
    camera: Camera,
    timeout: float = PROBE_TIMEOUT,
    *,
    interval: float = PROBE_INTERVAL,
) -> CameraTestResult:
    return probe_camera(redis, camera.id, timeout, interval=interval)


def probe_camera(
    redis: Redis,
    camera_id: UUID,
    timeout: float = PROBE_TIMEOUT,
    *,
    interval: float = PROBE_INTERVAL,
) -> CameraTestResult:
    """R9:同步轮询回复键;只用 id,不碰 ORM 对象和数据库;凭据由 worker 自己读库。"""
    camera = SimpleNamespace(id=camera_id)
    reply_key = PROBE_REPLY.format(uuid.uuid4())
    redis.rpush(PROBE_QUEUE, json.dumps({"id": str(camera.id), "reply_key": reply_key}))
    deadline = time.monotonic() + timeout
    while True:
        raw = redis.get(reply_key)
        if raw is not None:
            redis.delete(reply_key)
            try:
                return _checked(CameraTestResult.model_validate_json(raw))
            except ValidationError:
                return CameraTestResult(ok=False, message="转流服务返回了无法识别的结果")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return CameraTestResult(ok=False, message=NO_REPLY)
        time.sleep(min(interval, remaining))


def run_test(
    db: Session,
    redis: Redis,
    school_id: UUID,
    user_id: UUID,
    camera_id: UUID,
    request: Request | None,
    *,
    show_preview: bool = True,
) -> CameraTestResult:
    camera = get_camera(db, school_id, camera_id)
    cam_id, cam_name = camera.id, camera.name
    db.commit()  # 等待期间不占着数据库连接
    result = probe_camera(redis, cam_id, PROBE_TIMEOUT)
    record(
        db,
        user_id=user_id,
        action="camera.test",
        success=result.ok,
        object_type="camera",
        object_id=str(cam_id),
        request=request,
        extra={"name": cam_name},
    )
    db.commit()
    message = mask_url(result.message)
    preview = result.preview_jpeg_base64
    if preview is not None and not show_preview:
        # 视频不出校:预览图只给内网来源(不是错误,正常返回结果)
        preview = None
        message = f"{message};{PREVIEW_LAN_ONLY}"
    return CameraTestResult(ok=result.ok, message=message, preview_jpeg_base64=preview)


def public_hosts(redis: Redis) -> list[str]:
    raw = redis.get(PUBLIC_HOSTS_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(data, list):
        return []
    return [h for h in data if isinstance(h, str)]
