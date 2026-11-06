"""按需转流:后端续 ws:cam:want:<id>(30 秒),worker 每秒扫描,有标记没进程就起 ffmpeg,标记过期就停。"""

import asyncio
import contextlib
import json
import logging
import re
import shutil
import signal
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from redis.asyncio import Redis

from app import clock, crypto
from app.stream import ffmpeg, lan, source

log = logging.getLogger("app.stream")

WANT_PREFIX = "ws:cam:want:"
STATE_PREFIX = "ws:cam:state:"
RELOAD_CHANNEL = "ws:cam:reload"
PUBLIC_HOSTS_KEY = "ws:cam:public_hosts"
BACKOFF = (5, 10, 30, 60)  # 同一路连续失败后的重启间隔(秒)
STABLE_AFTER = 30  # 持续运行超过这么久再退出,算一次新的失败,退避重新从 5 秒开始
TERM_WAIT = 3.0  # SIGTERM 后等这么久,仍不退出则 SIGKILL
STDERR_KEEP = 5
# 看门狗:进程还在但播放列表很久没更新(摄像头掉线、RTSP 读挂住)就当失败处理并重连。
# copy 模式只能在关键帧处切片,index.m3u8 的 mtime 步进周期 = 摄像头的 GOP(智能编码的静态画面下
# 可达 10–15 秒,手动设置更长),所以阈值自适应:max(STALL_SECONDS, 3 × #EXT-X-TARGETDURATION),
# 再以 STALL_SECONDS_MAX 封顶——摄像头时间戳跳变会让 ffmpeg 写出巨大的 TARGETDURATION,
# 不封顶等于把看门狗关掉。比较的是文件 mtime 与墙上时间,不用 tick 的单调时钟
STALL_SECONDS = 30  # 下限;播放列表里读不到(或读到非正整数)TARGETDURATION 时就用它
STALL_SECONDS_MAX = 120  # 上限
STALL_TARGET_MULTIPLE = 3
STALL_MESSAGE = "画面停止更新,正在重连"
_TARGET_DURATION_RE = re.compile(r"^#EXT-X-TARGETDURATION:(\d+)", re.MULTILINE)
# 片段序列号从墙上秒数起编,mod 1e7:后端片段白名单是 ^seg-\d{1,8}\.ts$,7 位起编给跑到 8 位留
# 10 倍余量(回绕前启动的流继续往上编,9e7 个片段 ≈ 5.7 年也到不了 9 位)。每 2 秒最多产出 1 个片段,
# 新一轮的起始号 = 启动秒数 ≥ 上一轮起始号 + 上一轮时长 / 2 ≥ 上一轮用过的最大序列号,所以不论是退避
# 重启还是 reload / stop 后立刻重起,序列号都单调不减:正在看的 hls.js 看到的是序列号前跳 + 首段
# #EXT-X-DISCONTINUITY,而不是回退到 0。例外是 116 天一次的回绕(下一次 epoch 1 800 000 000,
# 2027-01-15 08:00 UTC),那一刻之后的重启序列号会回退一次,由 discont_start 兜底
START_NUMBER_MOD = 10**7


def _stall_threshold(playlist: str) -> float:
    """按 TARGETDURATION 算停更阈值,夹在 [STALL_SECONDS, STALL_SECONDS_MAX];读不到就用下限。"""
    found = _TARGET_DURATION_RE.search(playlist)
    if not found:
        return STALL_SECONDS
    try:
        target = int(found.group(1))
    except ValueError:  # 位数多到 int() 拒绝(Python 的整数字符串长度上限)
        return STALL_SECONDS
    if target <= 0:
        return STALL_SECONDS
    return min(STALL_SECONDS_MAX, max(STALL_SECONDS, STALL_TARGET_MULTIPLE * target))


@dataclass
class _Stream:
    proc: asyncio.subprocess.Process | None = None
    started_at: float = 0.0  # 单调时钟,只用于退避与稳定判定
    started_wall: int = 0  # 墙上时间戳,写进 state
    start_number: int = 0  # 本轮 ffmpeg 的首个片段序列号
    fail_count: int = 0
    next_retry_at: float = 0.0
    secrets: tuple[str, ...] = ()
    stderr: deque[str] = field(default_factory=lambda: deque(maxlen=STDERR_KEEP))
    reader: asyncio.Task | None = None
    status: str = "idle"
    last_error: str = ""


class Supervisor:
    def __init__(
        self,
        db_factory: source.DbFactory,
        redis: Redis,
        *,
        hls_root: Path,
        max_streams: int,
        ffmpeg_bin: str = "ffmpeg",
        master_key: bytes,
        allow_loopback: bool = False,
    ) -> None:
        self._db_factory = db_factory
        self._redis = redis
        self._root = hls_root
        self._max = max_streams
        self._bin = ffmpeg_bin
        self._key = master_key
        self._allow_loopback = allow_loopback
        self._streams: dict[UUID, _Stream] = {}
        self._stopping = asyncio.Event()
        self._lock = (
            asyncio.Lock()
        )  # tick / reload / shutdown 互斥,避免 reload 在 _launch 的 await 间隙里丢进程

    # ---- 状态 ----
    async def _write_state(self, cid: UUID, st: _Stream) -> None:
        mapping = {
            "status": st.status,
            "last_error": st.last_error,
            "started_at": str(st.started_wall) if st.proc else "",
            "updated_at": clock.utc_now().isoformat(),
        }
        await self._redis.hset(f"{STATE_PREFIX}{cid}", mapping=mapping)

    async def _set_error(self, cid: UUID, st: _Stream, message: str) -> None:
        if (st.status, st.last_error) != ("error", message):
            st.status, st.last_error = "error", message
            await self._write_state(cid, st)

    def _out_dir(self, cid: UUID) -> Path:
        return self._root / str(cid)

    # ---- 一轮 ----
    async def _wanted_ids(self) -> set[UUID]:
        ids: set[UUID] = set()
        async for key in self._redis.scan_iter(match=f"{WANT_PREFIX}*", count=200):
            with contextlib.suppress(ValueError):
                ids.add(UUID(key.removeprefix(WANT_PREFIX)))
        return ids

    async def tick(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        async with self._lock:
            await self._tick(now)

    async def _tick(self, now: float) -> None:
        wanted = await self._wanted_ids()
        for cid, st in list(self._streams.items()):
            if st.proc is not None and st.proc.returncode is not None:
                await self._on_exit(cid, st, now)
        for cid in list(self._streams):
            if cid not in wanted:
                await self._stop(cid)
        for cid in sorted(wanted, key=str):
            st = self._streams.setdefault(cid, _Stream())
            try:
                if st.proc is not None:
                    if st.status != "streaming" and (self._out_dir(cid) / "index.m3u8").exists():
                        st.status, st.last_error = "streaming", ""
                        await self._write_state(cid, st)
                    elif st.status == "streaming" and (stall := self._stalled(cid)) is not None:
                        await self._restart_stalled(cid, st, now, *stall)
                elif now >= st.next_retry_at:
                    await self._launch(cid, st, now)
            except Exception as exc:  # 一路出错不能拖住后面的摄像头
                log.warning("camera %s tick failed: %s", cid, type(exc).__name__)
                if st.proc is not None:  # 进程已起但后续出错:保留进程,下一轮再看
                    continue
                await self._backoff(cid, st, now, f"内部错误:{type(exc).__name__}")

    def _running(self) -> int:
        return sum(1 for s in self._streams.values() if s.proc is not None)

    async def _launch(self, cid: UUID, st: _Stream, now: float) -> None:
        if self._running() >= self._max:
            await self._set_error(cid, st, "busy")
            return
        row = await source.load_camera(self._db_factory, cid)
        if row is None or not row.enabled:
            st.next_retry_at = now + 5
            await self._set_error(cid, st, "摄像头不存在或已停用")
            return
        if not await source.host_is_lan(row, allow_loopback=self._allow_loopback):
            st.next_retry_at = now + 60
            log.warning("refuse non-LAN camera %s", cid)
            await self._set_error(cid, st, "摄像头地址不在内网,已拒绝拉流")
            return
        try:
            url, st.secrets = source.stream_url(row, self._key)
        except crypto.CryptoError:
            st.next_retry_at = now + 60
            await self._set_error(cid, st, "摄像头凭据无法解密(主密钥是否改过?)")
            return
        out_dir = self._out_dir(cid)
        shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        st.start_number = int(time.time()) % START_NUMBER_MOD
        args = ffmpeg.build_args(
            url, out_dir, transcode=row.transcode, start_number=st.start_number
        )
        try:
            st.proc = await asyncio.create_subprocess_exec(
                self._bin,
                *args,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            st.proc = None
            await self._backoff(cid, st, now, f"无法启动 ffmpeg:{type(exc).__name__}")
            return
        finally:
            del url, args
        st.started_at = now
        st.started_wall = int(clock.utc_now().timestamp())
        st.stderr.clear()
        st.reader = asyncio.create_task(self._read_stderr(st))
        st.status, st.last_error = "idle", ""
        await self._write_state(cid, st)
        log.info("stream started camera=%s", cid)

    async def _read_stderr(self, st: _Stream) -> None:
        """分块读 stderr 并按行打码;单行最多保留 8KiB,保证管道始终被读空(ffmpeg 不会被堵住)。"""
        proc = st.proc
        assert proc is not None and proc.stderr is not None
        buf = b""
        while chunk := await proc.stderr.read(4096):
            buf += chunk
            *lines, buf = buf.split(b"\n")
            buf = buf[-8192:]
            for raw in lines:
                line = ffmpeg.mask_text(raw.decode("utf-8", "replace").strip()[:2000], st.secrets)
                if line:
                    st.stderr.append(line)
                    log.debug("ffmpeg: %s", line)  # 逐帧告警很多,默认不进日志;最后一行进 last_error

    async def _on_exit(self, cid: UUID, st: _Stream, now: float) -> None:
        await self._drain_reader(st)
        message = st.stderr[-1] if st.stderr else f"ffmpeg 退出,代码 {st.proc.returncode}"  # type: ignore[union-attr]
        await self._fail(cid, st, now, message)

    def _stalled(self, cid: UUID) -> tuple[float | None, float] | None:
        """播放列表停更了就返回 (停更秒数, 阈值);没停更返回 None;文件不见了算停更,秒数为 None。"""
        index = self._out_dir(cid) / "index.m3u8"
        try:
            age = time.time() - index.stat().st_mtime
            text = index.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None, STALL_SECONDS
        threshold = _stall_threshold(text)
        return (age, threshold) if age > threshold else None

    async def _restart_stalled(
        self, cid: UUID, st: _Stream, now: float, age: float | None, threshold: float
    ) -> None:
        log.warning(
            "stream stalled camera=%s playlist_age=%s threshold=%.0fs",
            cid,
            "missing" if age is None else f"{age:.0f}s",
            threshold,
        )
        assert st.proc is not None
        await self._terminate(st.proc)
        await self._drain_reader(st)
        await self._fail(cid, st, now, STALL_MESSAGE)

    async def _drain_reader(self, st: _Stream) -> None:
        if st.reader is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(st.reader, 1)

    async def _fail(self, cid: UUID, st: _Stream, now: float, message: str) -> None:
        """进程已结束:清目录、按退避安排重启。稳定运行过一段的,退避重新从头算。"""
        if now - st.started_at >= STABLE_AFTER:
            st.fail_count = 0
        st.proc, st.reader = None, None
        shutil.rmtree(self._out_dir(cid), ignore_errors=True)
        await self._backoff(cid, st, now, message)

    async def _backoff(self, cid: UUID, st: _Stream, now: float, message: str) -> None:
        delay = BACKOFF[min(st.fail_count, len(BACKOFF) - 1)]
        st.fail_count += 1
        st.next_retry_at = now + delay
        st.status = "error"
        st.last_error = ffmpeg.mask_text(message, st.secrets)
        await self._write_state(cid, st)
        log.warning("stream failed camera=%s retry_in=%ss", cid, delay)

    # ---- 停 ----
    async def _terminate(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), TERM_WAIT)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()

    async def _stop(self, cid: UUID) -> None:
        st = self._streams.pop(cid, None)
        if st is None:
            return
        if st.proc is not None:
            await self._terminate(st.proc)
        if st.reader is not None:
            st.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await st.reader
        shutil.rmtree(self._out_dir(cid), ignore_errors=True)
        try:
            await self._redis.hset(
                f"{STATE_PREFIX}{cid}",
                mapping={
                    "status": "idle",
                    "last_error": "",
                    "started_at": "",
                    "updated_at": clock.utc_now().isoformat(),
                },
            )
        except Exception as exc:  # Redis 不可用也要先把进程收掉
            log.warning("state reset failed: %s", type(exc).__name__)
        log.info("stream stopped camera=%s", cid)

    async def handle_reload(self, cid: UUID) -> None:
        """后端改 / 删了摄像头:停旧进程;只要还有人在看,下一轮 tick 用新配置重起。"""
        async with self._lock:
            await self._stop(cid)
        await self.refresh_public_hosts()

    async def shutdown(self) -> None:
        async with self._lock:
            await asyncio.gather(*(self._stop(cid) for cid in list(self._streams)))

    # ---- 自检 ----
    async def refresh_public_hosts(self) -> list[str]:
        """全部登记的摄像头里,地址没解析到内网的主机名(不含凭据)写进 ws:cam:public_hosts。"""
        hosts: set[str] = set()
        for row in await source.load_all(self._db_factory):
            if not await source.host_is_lan(row, allow_loopback=self._allow_loopback):
                hosts.add(lan.url_host(row.url) or "(无法解析)")
        result = sorted(hosts)
        await self._redis.set(PUBLIC_HOSTS_KEY, json.dumps(result, ensure_ascii=False))
        return result

    async def _reset_states(self) -> None:
        """worker 重启:上一个进程留下的状态都不可信。"""
        async for key in self._redis.scan_iter(match=f"{STATE_PREFIX}*", count=200):
            await self._redis.delete(key)

    async def _reload_loop(self) -> None:
        """订阅断了就退避重连;断线期间可能错过 reload,所以重连前把全部流停掉重来。"""
        delay = 0.5
        while True:
            pubsub = self._redis.pubsub()
            try:
                await pubsub.subscribe(RELOAD_CHANNEL)
                delay = 0.5
                async for item in pubsub.listen():
                    if item["type"] != "message":
                        continue
                    try:
                        await self.handle_reload(UUID(str(item["data"])))
                    except Exception as exc:
                        log.warning("reload failed: %s", type(exc).__name__)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("reload subscription lost: %s", type(exc).__name__)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10)
            async with self._lock:  # 断线期间可能错过 reload:全部停掉,有人看的下一轮用新配置重起
                await asyncio.gather(*(self._stop(c) for c in list(self._streams)))

    def request_stop(self) -> None:
        self._stopping.set()

    def _clear_hls_root(self) -> None:
        """worker 被 SIGKILL 后旧目录还在(app 一直挂着卷):启动时清空。"""
        if self._root.is_dir():
            for child in self._root.iterdir():
                shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink(
                    missing_ok=True
                )

    async def run(self, heartbeat: Path | None = None) -> None:
        self._clear_hls_root()
        await self._reset_states()
        try:
            await self.refresh_public_hosts()
        except Exception as exc:  # 数据库暂时不可用不应让 worker 起不来
            log.warning("startup self-check failed: %s", type(exc).__name__)
        reload_task = asyncio.create_task(self._reload_loop())
        try:
            while not self._stopping.is_set():
                if heartbeat is not None:
                    with contextlib.suppress(OSError):
                        heartbeat.touch()
                try:
                    await self.tick()
                except Exception as exc:
                    log.warning("tick failed: %s", type(exc).__name__)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stopping.wait(), 1)
        finally:
            reload_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await reload_task
            await self.shutdown()
