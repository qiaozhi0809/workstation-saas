"""worker 读摄像头登记信息:取行、解密凭据、内网判定。明文凭据只返回给调用方,不写任何地方。"""

import asyncio
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto
from app.domain.cameras.lan import IPNetwork, resolve_lan_ips
from app.models.cameras import Camera
from app.stream import ffmpeg, lan

DbFactory = Callable[[], AbstractContextManager[Session]]
Networks = Iterable[IPNetwork]


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


async def resolve_lan(row: CameraRow, *, allow_loopback: bool, denied: Networks = ()) -> str | None:
    """判定并返回解析到的内网 IP;失败即关:取不到主机名、解析失败、任一结果不在内网
    或落在拒绝网段(可信代理 / compose 子网,L159)都返回 None。

    DNS 解析是阻塞调用,放线程里。拿到的 IP 要原样写进拉流地址(stream_url 的 pin_ip),
    这样 ffmpeg 连的就是判定过的那个地址(L155)。"""
    host = lan.url_host(row.url)
    if host is None or not lan.is_rtsp_url(row.url):  # 只拉 rtsp / rtsps,不让 ffmpeg 去取别的协议
        return None
    ips = await asyncio.to_thread(
        resolve_lan_ips, host, allow_loopback=allow_loopback, denied=tuple(denied)
    )
    return ips[0] if ips else None


async def host_is_lan(row: CameraRow, *, allow_loopback: bool, denied: Networks = ()) -> bool:
    return await resolve_lan(row, allow_loopback=allow_loopback, denied=denied) is not None


def pin_host(url: str, ip: str) -> str:
    """把 rtsp:// 地址的主机换成判定过的 IP(端口、路径、查询串不动)。

    rtsps:// 原样返回:TLS 证书按主机名校验,换成 IP 会把握手弄坏。"""
    parts = urlsplit(url)
    if parts.scheme.lower() != "rtsp":
        return url
    host = f"[{ip}]" if ":" in ip else ip
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))


def stream_url(
    row: CameraRow, master_key: bytes, *, pin_ip: str | None = None
) -> tuple[str, tuple[str, ...]]:
    """返回(带凭据的拉流地址, 需要在日志里打码的明文集合)。可能抛 crypto.CryptoError。

    pin_ip 是 resolve_lan 判定过的 IP:给了就写进地址(仅 rtsp://),ffmpeg 不再自己解析。"""
    username = password = None
    if row.username_enc:
        username = crypto.decrypt(row.username_enc, master_key, aad=f"camera:{row.id}:username")
    if row.password_enc:
        password = crypto.decrypt(row.password_enc, master_key, aad=f"camera:{row.id}:password")
    base = row.url if pin_ip is None else pin_host(row.url, pin_ip)
    url = ffmpeg.credentials_url(base, username, password)
    secrets = tuple(s for s in (username, password, url) if s)
    return url, secrets
