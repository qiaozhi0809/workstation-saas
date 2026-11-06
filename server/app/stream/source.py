"""worker 读摄像头登记信息:取行、解密凭据、内网判定。明文凭据只返回给调用方,不写任何地方。"""

import asyncio
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto
from app.models.cameras import Camera
from app.stream import ffmpeg, lan

DbFactory = Callable[[], AbstractContextManager[Session]]


@dataclass(frozen=True)
class CameraRow:
    id: UUID
    url: str
    username_enc: str | None
    password_enc: str | None
    enabled: bool
    transcode: bool


def _row(cam: Camera) -> CameraRow:
    return CameraRow(
        cam.id, cam.rtsp_url, cam.rtsp_username, cam.rtsp_password, cam.enabled, cam.transcode
    )


def _load_one(db_factory: DbFactory, camera_id: UUID) -> CameraRow | None:
    with db_factory() as db:
        cam = db.get(Camera, camera_id)
        return _row(cam) if cam is not None else None


def _load_all(db_factory: DbFactory) -> list[CameraRow]:
    with db_factory() as db:
        return [_row(c) for c in db.scalars(select(Camera))]


async def load_camera(db_factory: DbFactory, camera_id: UUID) -> CameraRow | None:
    return await asyncio.to_thread(_load_one, db_factory, camera_id)


async def load_all(db_factory: DbFactory) -> list[CameraRow]:
    return await asyncio.to_thread(_load_all, db_factory)


async def host_is_lan(row: CameraRow, *, allow_loopback: bool) -> bool:
    """失败即关:取不到主机名、解析失败都算"不是内网"。DNS 解析是阻塞调用,放线程里。"""
    host = lan.url_host(row.url)
    if host is None or not lan.is_rtsp_url(row.url):  # 只拉 rtsp / rtsps,不让 ffmpeg 去取别的协议
        return False
    return await asyncio.to_thread(lan.resolve_is_lan, host, allow_loopback=allow_loopback)


def stream_url(row: CameraRow, master_key: bytes) -> tuple[str, tuple[str, ...]]:
    """返回(带凭据的拉流地址, 需要在日志里打码的明文集合)。可能抛 crypto.CryptoError。"""
    username = password = None
    if row.username_enc:
        username = crypto.decrypt(row.username_enc, master_key, aad=f"camera:{row.id}:username")
    if row.password_enc:
        password = crypto.decrypt(row.password_enc, master_key, aad=f"camera:{row.id}:password")
    url = ffmpeg.credentials_url(row.url, username, password)
    secrets = tuple(s for s in (username, password, url) if s)
    return url, secrets
