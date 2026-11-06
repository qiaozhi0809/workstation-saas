"""测试连接:后端 RPUSH ws:cam:probe {id, reply_key},worker 拉 3 秒截一帧 JPEG 写回 reply_key。"""

import asyncio
import base64
import contextlib
import json
import logging
from uuid import UUID

from redis.asyncio import Redis

from app import crypto
from app.stream import ffmpeg, source

log = logging.getLogger("app.stream")

PROBE_KEY = "ws:cam:probe"
REPLY_PREFIX = "ws:cam:probe:reply:"
PROBE_TIMEOUT = 9.0  # 后端最多等 10 秒


def _result(ok: bool, message: str, jpeg: bytes | None = None) -> dict:
    preview = base64.b64encode(jpeg).decode() if jpeg else None
    return {"ok": ok, "message": message, "preview_jpeg_base64": preview}


async def _grab(ffmpeg_bin: str, url: str, secrets: tuple[str, ...]) -> dict:
    proc = await asyncio.create_subprocess_exec(
        ffmpeg_bin,
        *ffmpeg.probe_args(url),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), PROBE_TIMEOUT)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()
        return _result(False, "连接超时,摄像头没有响应")
    if out.startswith(b"\xff\xd8") and proc.returncode == 0:
        return _result(True, "连接成功", out)
    lines = [ln for ln in err.decode("utf-8", "replace").splitlines() if ln.strip()]
    reason = ffmpeg.mask_text(lines[-1].strip(), secrets) if lines else "没有取到画面"
    return _result(False, f"连不上摄像头:{reason}")


async def handle_probe(
    payload: str,
    redis: Redis,
    db_factory: source.DbFactory,
    *,
    ffmpeg_bin: str,
    master_key: bytes,
    allow_loopback: bool,
) -> None:
    try:
        task = json.loads(payload)
        camera_id, reply_key = UUID(str(task["id"])), str(task["reply_key"])
    except (ValueError, KeyError, TypeError):
        return
    if not reply_key.startswith(REPLY_PREFIX):  # 队列内容不可信:只写约定前缀下的键
        return
    row = await source.load_camera(db_factory, camera_id)
    if row is None:
        result = _result(False, "摄像头不存在")
    elif not await source.host_is_lan(row, allow_loopback=allow_loopback):
        result = _result(False, "摄像头地址不在内网,已拒绝拉流")
    else:
        try:
            url, secrets = source.stream_url(row, master_key)
        except crypto.CryptoError:
            result = _result(False, "摄像头凭据无法解密(主密钥是否改过?)")
        else:
            try:
                result = await _grab(ffmpeg_bin, url, secrets)
            except OSError as exc:
                result = _result(False, f"无法启动 ffmpeg:{type(exc).__name__}")
    await redis.set(reply_key, json.dumps(result, ensure_ascii=False), ex=30)


async def probe_loop(
    redis: Redis,
    db_factory: source.DbFactory,
    *,
    ffmpeg_bin: str,
    master_key: bytes,
    allow_loopback: bool,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            item = await redis.blpop([PROBE_KEY], timeout=1)
            if item is None:
                continue
            await handle_probe(
                item[1],
                redis,
                db_factory,
                ffmpeg_bin=ffmpeg_bin,
                master_key=master_key,
                allow_loopback=allow_loopback,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("probe failed: %s", type(exc).__name__)
            await asyncio.sleep(1)
