import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from redis import Redis
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import deny, record
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.cameras import access, playback
from app.errors import ApiError
from app.models import User
from app.models.cameras import Camera
from app.rbac.bindings import Binding
from app.rbac.deps import get_bindings
from app.redis import get_redis

router = APIRouter(tags=["cameras"])


@dataclass
class Timing:
    """等待播放列表的参数;测试通过依赖覆盖注入短超时 / 假时钟。"""

    timeout: float = 8
    interval: float = 0.2
    sleep: Callable[[float], None] = field(default=time.sleep)
    monotonic: Callable[[], float] = field(default=time.monotonic)


def get_timing() -> Timing:
    return Timing()


Auth = Annotated[User, Depends(get_current_user)]
Bind = Annotated[list[Binding], Depends(get_bindings)]
Db = Annotated[Session, Depends(get_db)]
Rds = Annotated[Redis, Depends(get_redis)]
Cfg = Annotated[Settings, Depends(settings_dep)]
Tim = Annotated[Timing, Depends(get_timing)]

PLAYLIST_TYPE = "application/vnd.apple.mpegurl"
NO_STORE = {"Cache-Control": "no-store"}


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "摄像头不存在")


def _enabled_camera(db: Session, camera_id: UUID, school_id: UUID | None) -> Camera:
    """停用的摄像头对所有人都是 404(包括 camera.manage:管理页另有入口)。"""
    camera = db.get(Camera, camera_id)
    if (
        camera is None
        or not camera.enabled
        or (school_id is not None and camera.school_id != school_id)
    ):
        raise _not_found()
    return camera


@router.get("/cameras/{camera_id}/stream.m3u8")
def get_playlist(
    camera_id: UUID,
    request: Request,
    user: Auth,
    bindings: Bind,
    db: Db,
    redis: Rds,
    settings: Cfg,
    timing: Tim,
) -> Response:
    camera = _enabled_camera(db, camera_id, user.school_id)
    access.ensure_monitor_on(db, user.school_id)
    playback.ensure_lan(request, settings)
    now = clock.utc_now()
    if access.can_view(db, user, bindings, camera, now) is None:
        # 对无权者不透露这路摄像头有没有流
        if redis.set(f"ws:cam:deny:{user.id}:{camera.id}", "1", nx=True, ex=60):
            deny(  # 同一用户同一摄像头 60 秒内只记一次失败审计
                db,
                user_id=user.id,
                action="camera.view",
                object_type="camera",
                object_id=str(camera.id),
                request=request,
            )
        raise ApiError(403, "FORBIDDEN", "没有权限访问该资源")
    state = redis.hmget(access.STATE_KEY.format(camera.id), "status", "last_error")
    if state[0] == "error" and state[1] == "busy":
        raise ApiError(503, "STREAM_BUSY", "同时观看的摄像头太多,请稍后再试", headers=NO_STORE)
    playback.touch_want(redis, camera.id)
    index = settings.hls_root / str(camera.id) / "index.m3u8"
    ready = playback.await_playlist(
        index, timing.timeout, timing.interval, sleep=timing.sleep, monotonic=timing.monotonic
    )
    try:
        body = index.read_text(encoding="utf-8", errors="replace") if ready else None
    except OSError:
        body = None
    if body is None:
        raise ApiError(503, "STREAM_STARTING", "摄像头正在启动,请稍后重试", headers=NO_STORE)
    exp = int(_epoch(now)) + playback.MAX_TTL
    sig = playback.sign(settings, camera.id, user.id, exp)
    if playback.audit_due(redis, user.id, camera.id):
        record(
            db,
            user_id=user.id,
            action="camera.view",
            success=True,
            object_type="camera",
            object_id=str(camera.id),
            request=request,
            extra={"camera_id": str(camera.id), "camera_name": camera.name},
        )
        db.commit()
    text = playback.rewrite_playlist(body, camera.id, user.id, exp, sig)
    return Response(text, media_type=PLAYLIST_TYPE, headers=NO_STORE)


def _epoch(moment: datetime) -> float:
    return moment.timestamp()


def _parse_uuid(value: str | None) -> UUID | None:
    try:
        return UUID(value) if value else None
    except ValueError:
        return None


@router.get("/cameras/{camera_id}/hls/{name}")
def get_segment(
    camera_id: UUID,
    name: str,
    request: Request,
    db: Db,
    settings: Cfg,
    exp: str | None = None,
    u: str | None = None,
    sig: str | None = None,
) -> Response:
    """只认签名 + 内网来源,不要 JWT(R9:已签发的地址最多再用 60 秒)。"""
    playback.ensure_lan(request, settings)
    if not playback.SEGMENT_RE.fullmatch(name):
        raise _not_found()
    user_id = _parse_uuid(u)
    exp_i = (
        int(exp) if exp is not None and len(exp) <= 12 and exp.isascii() and exp.isdigit() else None
    )
    forbidden = ApiError(403, "FORBIDDEN", "没有权限访问该资源")
    if user_id is None or exp_i is None or not sig:
        raise forbidden
    if not playback.verify(settings, camera_id, user_id, exp_i, sig, _epoch(clock.utc_now())):
        raise forbidden
    # 签名通过后才查库:未签名的调用者碰不到数据库
    camera = _enabled_camera(db, camera_id, None)
    access.ensure_monitor_on(db, camera.school_id)
    base = (settings.hls_root / str(camera.id)).resolve()
    path = (base / name).resolve()
    if not path.is_relative_to(base):
        raise _not_found()
    try:
        data = path.read_bytes()
    except OSError:
        raise _not_found() from None
    return Response(data, media_type="video/mp2t", headers=NO_STORE)
