"""按需转流:后端续 ws:cam:want:<id>(30 秒),worker 每秒扫描,有标记没进程就起 ffmpeg,标记过期就停。"""

import asyncio
import contextlib
import json
import logging
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


@dataclass
class _Stream:
    proc: asyncio.subprocess.Process | None = None
    started_at: float = 0.0
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

    # ---- 状态 ----
    async def _write_state(self, cid: UUID, st: _Stream) -> None:
        mapping = {
            "status": st.status,
            "last_error": st.last_error,
            "started_at": str(int(st.started_at)) if st.proc else "",
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
        wanted = await self._wanted_ids()
        for cid, st in list(self._streams.items()):
            if st.proc is not None and st.proc.returncode is not None:
                await self._on_exit(cid, st, now)
        for cid in list(self._streams):
            if cid not in wanted:
                await self._stop(cid)
        for cid in sorted(wanted, key=str):
            st = self._streams.setdefault(cid, _Stream())
            if st.proc is not None:
                if st.status != "streaming" and (self._out_dir(cid) / "index.m3u8").exists():
                    st.status, st.last_error = "streaming", ""
                    await self._write_state(cid, st)
                continue
            if now >= st.next_retry_at:
                await self._launch(cid, st, now)

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
        args = ffmpeg.build_args(url, out_dir, transcode=row.transcode)
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
        st.stderr.clear()
        st.reader = asyncio.create_task(self._read_stderr(st))
        st.status, st.last_error = "idle", ""
        await self._write_state(cid, st)
        log.info("stream started camera=%s", cid)

    async def _read_stderr(self, st: _Stream) -> None:
        proc = st.proc
        assert proc is not None and proc.stderr is not None
        async for raw in proc.stderr:
            line = ffmpeg.mask_text(raw.decode("utf-8", "replace").strip(), st.secrets)
            if line:
                st.stderr.append(line)
                log.info("ffmpeg: %s", line)

    async def _on_exit(self, cid: UUID, st: _Stream, now: float) -> None:
        if st.reader is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(st.reader, 1)
        message = st.stderr[-1] if st.stderr else f"ffmpeg 退出,代码 {st.proc.returncode}"  # type: ignore[union-attr]
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
        await self._redis.hset(
            f"{STATE_PREFIX}{cid}",
            mapping={
                "status": "idle",
                "last_error": "",
                "started_at": "",
                "updated_at": clock.utc_now().isoformat(),
            },
        )
        log.info("stream stopped camera=%s", cid)

    async def handle_reload(self, cid: UUID) -> None:
        """后端改 / 删了摄像头:停旧进程;只要还有人在看,下一轮 tick 用新配置重起。"""
        await self._stop(cid)
        await self.refresh_public_hosts()

    async def shutdown(self) -> None:
        for cid in list(self._streams):
            await self._stop(cid)

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
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(RELOAD_CHANNEL)
        try:
            async for item in pubsub.listen():
                if item["type"] != "message":
                    continue
                try:
                    await self.handle_reload(UUID(str(item["data"])))
                except Exception as exc:
                    log.warning("reload failed: %s", type(exc).__name__)
        finally:
            await pubsub.aclose()

    def request_stop(self) -> None:
        self._stopping.set()

    async def run(self, heartbeat: Path | None = None) -> None:
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
