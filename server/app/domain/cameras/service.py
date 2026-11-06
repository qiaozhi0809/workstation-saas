import base64
import binascii
import contextlib
import json
import time
import uuid
from types import SimpleNamespace, TracebackType
from uuid import UUID

import structlog
from fastapi import Request
from pydantic import ValidationError
from redis import Redis
from redis.exceptions import RedisError
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
REDIS_DOWN = "转流服务暂时不可用,请稍后再试"

log = structlog.get_logger()


class Redis503(contextlib.ContextDecorator):
    """Redis 故障(连不上、超时)→ 503 SERVICE_UNAVAILABLE + 中文提示,不是 500(L163)。

    状态 / 测试连接 / 按需拉流都经 Redis,它一挂摄像头功能就整个不可用,给用户一句能看懂的话。
    既可当装饰器包整个服务函数,也可 with 包一段。只拦 RedisError,别的异常照常冒出去。"""

    def __enter__(self) -> "Redis503":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        if isinstance(exc, RedisError):
            log.warning("cameras.redis_unavailable", error=type(exc).__name__)
            raise ApiError(
                503, "SERVICE_UNAVAILABLE", REDIS_DOWN, headers={"Cache-Control": "no-store"}
            ) from exc
        return False


def _notify_reload(redis: Redis, camera_id: UUID) -> None:
    """改 / 删已经提交之后才通知 worker:Redis 这时出错只告警,不能把已保存的改动报成失败。

    吞掉这个错误的代价是一个窗口:通知没送到,worker 继续按旧地址 / 旧凭据拉流,或继续拉一个
    已停用 / 已删除的摄像头。窗口结束于三者之一:没人看了、ws:cam:want 键过期(30 秒)worker
    把流停掉;worker 的订阅断线重连(重连前停掉全部流重读配置);worker 重启。有人一直在看、
    且 Redis 只是瞬断没触发订阅重连时,旧流会一直拉到有人停看为止——这是接受的代价,不在这里重试。"""
    try:
        redis.publish(RELOAD_CHANNEL, str(camera_id))
    except RedisError as exc:
        log.warning(
            "cameras.reload_publish_failed", camera_id=str(camera_id), error=type(exc).__name__
        )


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


def _out(db: Session, camera: Camera, state: tuple[str, str | None]) -> CameraOut:
    return camera_out(camera, state, include_url=True, class_name=_class_name(db, camera.class_id))


@Redis503()
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
    # settings 带可信网段:解析到 compose 子网的地址也拒绝(L159)
    return validate_rtsp_url(data.rtsp_url, allow_loopback=settings.env == "dev", settings=settings)


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
    # 新摄像头不可能有 worker 状态:不读 Redis,Redis 故障时也能登记(重试不会重复建)
    return _out(db, camera, ("idle", None))


@Redis503()
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
    state = _state(redis, camera.id)  # 提交之前读:Redis 故障就 503,不会出现"存了却报错"
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
        _notify_reload(redis, camera.id)
    return _out(db, camera, state)


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
    _notify_reload(redis, camera_id)


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


@Redis503()
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
        # 视频不出校:预览图只给内网来源(不是错误,正常返回结果);编解码信息不涉及画面,照常返回
        preview = None
        message = f"{message};{PREVIEW_LAN_ONLY}"
    return CameraTestResult(
        ok=result.ok, message=message, preview_jpeg_base64=preview, probe=result.probe
    )


@Redis503()
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
