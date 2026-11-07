"""stream-worker 性能冒烟(台账 L176 的 CI 版本)。

真 ffmpeg 对假摄像头 cam1 同时起 3 路 copy 流 + 1 路转码流(四行不同的摄像头登记指向同一地址),
跑 30 秒,从 /proc/<pid>/stat 与 /proc/<pid>/status 采样 ffmpeg 子进程的 CPU 时间与 VmRSS,
最后打印一行 ``PERF copy=3 transcode=1 cpu_total=…% rss_total=…MB first_segment_s=…``;
只断言"30 秒内每路都出了片段",不对数字设门槛——数字由后续段写进 README 时标注
"GitHub runner 2 vCPU 参考值"。

依赖本机 ffmpeg、127.0.0.1:${WS_RTSP_PORT:-8554} 上的假摄像头(docker compose --profile camera)
与 Linux 的 /proc;缺任一项在收集阶段就 skip(不起 testcontainers)。仓库里没有 psutil,也不为此加依赖。
"""

import asyncio
import os
import shutil
import socket
import time
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy.orm import Session

from app.models.cameras import Camera
from app.stream.supervisor import STATE_PREFIX, WANT_PREFIX, Supervisor
from tests.seed_ids import SCHOOL_ID

RTSP_PORT = int(os.environ.get("WS_RTSP_PORT", "8554"))
CAM1 = f"rtsp://127.0.0.1:{RTSP_PORT}/cam1"
COPY_STREAMS = 3
TRANSCODE_STREAMS = 1
RUN_SECONDS = 30.0
SAMPLE_SECONDS = 1.0
WANT_TTL = 60  # 每秒续一次,比 supervisor 自己用的 30 秒宽
KEY = b"k" * 32  # 测试主密钥;本测试的摄像头没有凭据,只是 Supervisor 的必填参数
PROC = Path("/proc")


def _skip_reason() -> str | None:
    if shutil.which("ffmpeg") is None:
        return "本机没有 ffmpeg"
    try:
        with socket.create_connection(("127.0.0.1", RTSP_PORT), timeout=1):
            pass
    except OSError:
        return f"假摄像头没有在 127.0.0.1:{RTSP_PORT} 监听(docker compose --profile camera)"
    if not (PROC / "self" / "stat").exists():
        return "需要 Linux 的 /proc 读 ffmpeg 子进程的 CPU 与内存(macOS 上不跑)"
    return None


_REASON = _skip_reason()
pytestmark = [
    pytest.mark.ffmpeg,
    pytest.mark.perf,
    pytest.mark.skipif(_REASON is not None, reason=_REASON or ""),
]


# ---------- /proc 采样(纯函数,便于核对字段位置) ----------


def cpu_seconds_from_stat(stat: str, clk_tck: int) -> float:
    """/proc/<pid>/stat 的 utime(第 14 字段)+ stime(第 15 字段),单位 clock tick → 秒。

    comm 可能含空格或括号,所以从最后一个 ')' 之后再按空格切;切出来的列表从第 3 字段(state)开始。"""
    rest = stat[stat.rindex(")") + 2 :].split()
    utime, stime = int(rest[11]), int(rest[12])
    return (utime + stime) / clk_tck


def rss_mb_from_status(status: str) -> float | None:
    """/proc/<pid>/status 的 VmRSS(kB)→ MB;没有这一行(进程刚退出)返回 None。"""
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024
    return None


def _cpu_seconds(pid: int) -> float | None:
    try:
        return cpu_seconds_from_stat((PROC / str(pid) / "stat").read_text(), _clk_tck())
    except (OSError, ValueError, IndexError):
        return None


def _rss_mb(pid: int) -> float | None:
    try:
        return rss_mb_from_status((PROC / str(pid) / "status").read_text())
    except OSError:
        return None


def _clk_tck() -> int:
    return int(os.sysconf("SC_CLK_TCK"))


def _fmt(seconds: float | None) -> str:
    return "-" if seconds is None else f"{seconds:.1f}"


# ---------- 测试数据 ----------


def make_camera(db: Session, *, transcode: bool) -> Camera:
    cam = Camera(
        id=uuid4(),
        school_id=UUID(SCHOOL_ID),
        name="性能冒烟",
        location="教室",
        rtsp_url=CAM1,
        enabled=True,
        transcode=transcode,
    )
    db.add(cam)
    db.flush()
    return cam


def run_async(redis_url: str, fn: Callable[[AsyncRedis], Awaitable[None]]) -> None:
    async def main() -> None:
        redis = AsyncRedis.from_url(redis_url, decode_responses=True)
        await redis.flushdb()
        try:
            await fn(redis)
        finally:
            await redis.aclose()

    asyncio.run(main())


def test_three_copy_one_transcode_30s(db, redis_url, tmp_path):
    cams = [make_camera(db, transcode=False) for _ in range(COPY_STREAMS)]
    cams += [make_camera(db, transcode=True) for _ in range(TRANSCODE_STREAMS)]
    hls_root = tmp_path / "hls"
    hls_root.mkdir()

    @contextmanager
    def scope():
        yield db

    async def keep_wanted(redis: AsyncRedis) -> None:
        for c in cams:
            await redis.set(f"{WANT_PREFIX}{c.id}", "1", ex=WANT_TTL)

    def has_segment(cam: Camera) -> bool:
        return any((hls_root / str(cam.id)).glob("seg-*.ts"))

    async def body(redis: AsyncRedis) -> None:
        sup = Supervisor(
            scope,
            redis,
            hls_root=hls_root,
            max_streams=COPY_STREAMS + TRANSCODE_STREAMS,
            ffmpeg_bin=shutil.which("ffmpeg") or "ffmpeg",
            master_key=KEY,
            allow_loopback=True,
        )
        first_segment: dict[UUID, float] = {}
        cpu_by_pid: dict[int, float] = {}  # 进程重启过也算进去:按 pid 记最后一次读到的 CPU 时间
        rss_peak = 0.0
        started = time.monotonic()
        try:
            await keep_wanted(redis)
            await sup.tick()
            while (elapsed := time.monotonic() - started) < RUN_SECONDS:
                await asyncio.sleep(SAMPLE_SECONDS)
                await keep_wanted(redis)
                await sup.tick()
                now = time.monotonic() - started
                for c in cams:
                    if c.id not in first_segment and has_segment(c):
                        first_segment[c.id] = now
                pids = sup.running_pids()
                rss_now = 0.0
                for pid in pids:
                    cpu = _cpu_seconds(pid)
                    if cpu is not None:
                        cpu_by_pid[pid] = cpu
                    rss_now += _rss_mb(pid) or 0.0
                rss_peak = max(rss_peak, rss_now)
            states = {str(c.id): await redis.hgetall(f"{STATE_PREFIX}{c.id}") for c in cams}
        finally:
            await sup.shutdown()

        cpu_total = sum(cpu_by_pid.values()) / elapsed * 100
        copy_first = "/".join(_fmt(first_segment.get(c.id)) for c in cams[:COPY_STREAMS])
        transcode_first = "/".join(_fmt(first_segment.get(c.id)) for c in cams[COPY_STREAMS:])
        worst = max(first_segment.values(), default=None)
        # 一行,便于从 CI 日志 / artifact 里抓:cpu_total 是四个 ffmpeg 进程 CPU 时间之和占墙上时间的
        # 百分比(2 vCPU 的 runner 上 200% 即打满),rss_total 是采样期间四个进程 RSS 之和的峰值
        print(
            f"PERF copy={COPY_STREAMS} transcode={TRANSCODE_STREAMS} cpu_total={cpu_total:.0f}% "
            f"rss_total={rss_peak:.0f}MB first_segment_s={_fmt(worst)} "
            f"(copy {copy_first} transcode {transcode_first}; run={elapsed:.0f}s)"
        )
        missing = [str(c.id) for c in cams if c.id not in first_segment]
        assert not missing, f"{RUN_SECONDS:.0f} 秒内没有出片段的路:{missing};状态:{states}"

    run_async(redis_url, body)
