"""ffmpeg / ffprobe 命令行拼装与日志打码。带凭据的地址只在 worker 内存里,不进日志、不进 Redis。"""

import os
import re
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

# ffmpeg 拉不通时不能无限挂住:RTSP 套接字 I/O 超时 8 秒(微秒)
RTSP_IO_TIMEOUT_US = "8000000"
# 输入只允许 RTSP 及其传输层用到的协议,拒绝 http / file / concat 等(库里地址被改写也读不了本地文件)
PROTOCOL_WHITELIST = "rtsp,rtsps,rtp,srtp,udp,tcp,tls,crypto"

_USERINFO_RE = re.compile(r"(?i)([a-z][a-z0-9+.\-]*://)[^/@\s]*@")
_QUERY_SECRET_RE = re.compile(r"(?i)\b(password|passwd|pwd|token|sig)=[^&\s]*")


def build_args(url: str, out_dir: Path, *, transcode: bool, start_number: int = 0) -> list[str]:
    """不含可执行文件名。默认直接复制视频流;勾了"转码"改成 720p H.264。

    start_number 是首个片段的序列号(也是 seg-%d.ts 的编号):重启时由 supervisor 给一个比上一轮
    都大的值,配合 discont_start 让正在看的 hls.js 把它当作新的不连续段接着放,而不是序列回退。"""
    args = ["-hide_banner", "-loglevel", "warning", "-nostdin"]
    args += ["-protocol_whitelist", PROTOCOL_WHITELIST]
    args += ["-rtsp_transport", "tcp", "-timeout", RTSP_IO_TIMEOUT_US, "-i", url, "-an"]
    if transcode:
        # -threads 2:编码线程封顶,多路转码时不互相抢满整机;-pix_fmt yuv420p:摄像头常见的
        # 4:2:2 / 10bit 源转成浏览器都能解的 8bit 4:2:0
        args += [
            *("-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency"),
            *("-vf", "scale=-2:720", "-g", "50"),
            *("-threads", "2", "-pix_fmt", "yuv420p"),
        ]
    else:
        args += ["-c:v", "copy"]
    args += [
        *("-f", "hls", "-hls_time", "2", "-hls_list_size", "6"),
        *("-hls_flags", "delete_segments+independent_segments+discont_start"),
        *("-start_number", str(start_number)),
        *("-hls_segment_filename", str(out_dir / "seg-%d.ts")),
        str(out_dir / "index.m3u8"),
    ]
    return args


def probe_args(url: str) -> list[str]:
    """拉 3 秒、截一帧 JPEG(宽度不超过 640)写到 stdout。"""
    return [
        *("-hide_banner", "-loglevel", "warning", "-nostdin"),
        *("-protocol_whitelist", PROTOCOL_WHITELIST),
        *("-rtsp_transport", "tcp", "-timeout", RTSP_IO_TIMEOUT_US, "-i", url),
        *("-t", "3", "-frames:v", "1", "-an"),
        *("-vf", "scale='min(640,iw)':-2"),
        *("-f", "image2", "-c:v", "mjpeg", "pipe:1"),
    ]


def ffprobe_args(url: str) -> list[str]:
    """ffprobe 读流信息(编码、分辨率、帧率、码率),JSON 写到 stdout;网络约束与 ffmpeg 同一套。"""
    return [
        *("-v", "error", "-print_format", "json", "-show_streams", "-show_format"),
        *("-protocol_whitelist", PROTOCOL_WHITELIST),
        *("-rtsp_transport", "tcp", "-timeout", RTSP_IO_TIMEOUT_US, "-i", url),
    ]


def ffprobe_bin_for(ffmpeg_bin: str) -> str:
    """ffprobe 与 ffmpeg 装在一起:给了目录就取同目录下的 ffprobe,只给名字就按 PATH 找。"""
    directory = os.path.dirname(ffmpeg_bin)
    return os.path.join(directory, "ffprobe") if directory else "ffprobe"


def credentials_url(url: str, username: str | None, password: str | None) -> str:
    """把用户名密码百分号编码后拼进 userinfo。结果只能传给 ffmpeg,不得记录。"""
    if not username and not password:
        return url
    parts = urlsplit(url)
    host = parts.hostname or ""
    if ":" in host:  # IPv6 字面量
        host = f"[{host}]"
    if parts.port:
        host = f"{host}:{parts.port}"
    userinfo = quote(username or "", safe="")
    if password:
        userinfo += ":" + quote(password, safe="")
    return urlunsplit((parts.scheme, f"{userinfo}@{host}", parts.path, parts.query, parts.fragment))


def mask_text(text: str, secrets: tuple[str, ...] = ()) -> str:
    """打码 userinfo、查询串里的口令字段,以及已知的明文口令(含百分号编码形式)。"""
    text = _USERINFO_RE.sub(r"\1***@", text)
    text = _QUERY_SECRET_RE.sub(r"\1=***", text)
    for secret in secrets:
        if secret:
            for variant in {secret, quote(secret, safe="")}:
                text = text.replace(variant, "***")
    return text


def mask_url(url: str) -> str:
    return mask_text(url)
