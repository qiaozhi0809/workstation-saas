"""测试连接:后端 RPUSH ws:cam:probe {id, reply_key},worker 并行拉 3 秒截一帧 JPEG、跑一次 ffprobe
读编解码信息,一起写回 reply_key。截图决定 ok;ffprobe 只补充 probe,失败不影响截图结果。"""

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
FFPROBE_TIMEOUT = 6.0  # 与截图并行;超时只丢编解码信息

# 浏览器(MSE)普遍只解 H.264;H.265 只有少数机器有硬解。海康 / 大华主码流默认 H.265,
# copy 模式下 ffmpeg 能出 HLS、截图也成功,但浏览器放不了——测试连接时就要说清楚
HINT_HEVC = (
    "该摄像头是 H.265(HEVC)编码,大多数电脑浏览器不能直接播放:"
    "请改用摄像头的 H.264 子码流(海康 /Streaming/Channels/102,大华 subtype=1),"
    "或勾选转码(每路约占 1 核 CPU)"
)
HINT_HEVC_TRANSCODED = (
    "H.265 源已勾选转码,浏览器可以播放;每路转码约占 1 核 CPU,建议改用 H.264 子码流以省资源"
)
HINT_OTHER = "视频编码 {codec} 浏览器不支持,请勾选转码或改用 H.264 码流"


def browser_playable(video_codec: str | None, transcode: bool) -> bool:
    """H.264 直接可播;其余(hevc、mpeg4、mjpeg…)只有转码后才能播。"""
    return video_codec == "h264" or transcode


def probe_hint(video_codec: str | None, transcode: bool) -> str | None:
    """给信息中心看的中文提示;H.264 或编码未知时没有。"""
    if video_codec is None or video_codec == "h264":
        return None
    if video_codec == "hevc":
        return HINT_HEVC_TRANSCODED if transcode else HINT_HEVC
    return None if transcode else HINT_OTHER.format(codec=video_codec)


def _result(ok: bool, message: str, jpeg: bytes | None = None) -> dict:
    preview = base64.b64encode(jpeg).decode() if jpeg else None
    return {"ok": ok, "message": message, "preview_jpeg_base64": preview, "probe": None}


async def _exec(binary: str, args: list[str], timeout: float) -> tuple[bytes, bytes, int] | None:
    """跑子进程并收齐输出;超时返回 None。超时、被取消、异常都要收掉子进程。"""
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        return None
    finally:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await asyncio.shield(proc.wait())
    assert proc.returncode is not None
    return out, err, proc.returncode


async def _grab(ffmpeg_bin: str, url: str, secrets: tuple[str, ...]) -> dict:
    run = await _exec(ffmpeg_bin, ffmpeg.probe_args(url), PROBE_TIMEOUT)
    if run is None:
        return _result(False, "连接超时,摄像头没有响应")
    out, err, code = run
    if out.startswith(b"\xff\xd8") and code == 0:
        return _result(True, "连接成功", out)
    reason = ffmpeg.mask_text(_last_line(err), secrets) or "没有取到画面"
    return _result(False, f"连不上摄像头:{reason}")


def _last_line(err: bytes) -> str:
    lines = [ln.strip() for ln in err.decode("utf-8", "replace").splitlines() if ln.strip()]
    return lines[-1] if lines else ""


# ---- ffprobe ----


def _int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():  # ffprobe 的 bit_rate 是字符串
        return int(value)
    return None


def _fps(value: object) -> float | None:
    """r_frame_rate 形如 "25/1"、"30000/1001";分母为 0 或格式不对 → None。"""
    if not isinstance(value, str):
        return None
    num, _, den = value.partition("/")
    if not num.isdigit():
        return None
    if not den:
        return float(num)
    if not den.isdigit() or int(den) == 0:
        return None
    return round(int(num) / int(den), 2)


def _codec(stream: dict | None) -> str | None:
    name = stream.get("codec_name") if stream else None
    return name if isinstance(name, str) and name else None


def parse_ffprobe(data: object) -> dict | None:
    """从 ffprobe 的 JSON 里取第一路视频流(与第一路音频流的编码);没有视频流 → None。

    只取需要的字段:format.filename 里有带凭据的地址,整段 JSON 不得外传。"""
    if not isinstance(data, dict) or not isinstance(data.get("streams"), list):
        return None
    streams = [s for s in data["streams"] if isinstance(s, dict)]
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        return None
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = data.get("format")
    bps = _int(video.get("bit_rate"))
    if bps is None and isinstance(fmt, dict):  # 流级没有码率就取容器级的
        bps = _int(fmt.get("bit_rate"))
    return {
        "video_codec": _codec(video),
        "width": _int(video.get("width")),
        "height": _int(video.get("height")),
        "fps": _fps(video.get("r_frame_rate")),
        "bitrate_kbps": round(bps / 1000) if bps else None,
        "audio_codec": _codec(audio),
    }


async def _ffprobe(ffprobe_bin: str, url: str, secrets: tuple[str, ...]) -> dict | None:
    """ffprobe 只是补充信息:任何异常都吞成 None,不能把截图成功的结果拖成"测试失败"。"""
    try:
        return await _ffprobe_unguarded(ffprobe_bin, url, secrets)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.warning("ffprobe crashed: %s", type(exc).__name__)
        return None


async def _ffprobe_unguarded(ffprobe_bin: str, url: str, secrets: tuple[str, ...]) -> dict | None:
    """失败、超时、输出不是 JSON、找不到可执行文件都返回 None——只少编解码信息,不影响截图。"""
    try:
        run = await _exec(ffprobe_bin, ffmpeg.ffprobe_args(url), FFPROBE_TIMEOUT)
    except OSError as exc:
        log.warning("ffprobe unavailable: %s", type(exc).__name__)
        return None
    if run is None:
        log.debug("ffprobe timed out")
        return None
    out, err, code = run
    if code != 0:
        log.debug("ffprobe failed: %s", ffmpeg.mask_text(_last_line(err), secrets))
        return None
    try:
        data = json.loads(out)
    except ValueError:
        return None
    return parse_ffprobe(data)


def _with_probe(result: dict, info: dict | None, transcode: bool) -> dict:
    if info is None:
        return result
    codec = info["video_codec"]
    probe = {
        **info,
        "browser_playable": browser_playable(codec, transcode),
        "hint": probe_hint(codec, transcode),
    }
    return {**result, "probe": probe}


async def handle_probe(
    payload: str,
    redis: Redis,
    db_factory: source.DbFactory,
    *,
    ffmpeg_bin: str,
    master_key: bytes,
    allow_loopback: bool,
    ffprobe_bin: str | None = None,
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
            probe_bin = ffprobe_bin or ffmpeg.ffprobe_bin_for(ffmpeg_bin)
            try:
                grab, info = await asyncio.gather(
                    _grab(ffmpeg_bin, url, secrets), _ffprobe(probe_bin, url, secrets)
                )
                result = _with_probe(grab, info, row.transcode)
            except Exception as exc:  # 不回写的话后端只能空等 10 秒
                result = _result(False, f"测试失败:{type(exc).__name__}")
    await redis.set(reply_key, json.dumps(result, ensure_ascii=False), ex=30)


async def probe_loop(
    redis: Redis,
    db_factory: source.DbFactory,
    *,
    ffmpeg_bin: str,
    master_key: bytes,
    allow_loopback: bool,
    stop: asyncio.Event,
    ffprobe_bin: str | None = None,
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
                ffprobe_bin=ffprobe_bin,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("probe failed: %s", type(exc).__name__)
            await asyncio.sleep(1)
