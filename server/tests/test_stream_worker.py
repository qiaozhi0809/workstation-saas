"""stream-worker:假 ffmpeg 组(无需真视频)与真 ffmpeg 组(-m ffmpeg,缺环境时 skip)。"""

import asyncio
import base64
import contextlib
import ipaddress
import json
import logging
import os
import shutil
import signal
import socket
import stat
import sys
import time
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy.orm import Session

from app import crypto
from app.domain.cameras import lan as backend_lan
from app.models.cameras import Camera
from app.stream import ffmpeg, lan, probe, source
from app.stream.supervisor import PUBLIC_HOSTS_KEY, STATE_PREFIX, WANT_PREFIX, Supervisor
from tests.conftest import TEST_JWT_SECRET  # noqa: F401  (确保 conftest 已加载)
from tests.seed_ids import SCHOOL_ID

KEY = b"k" * 32
USER, PASSWORD = "camuser", "campass-test"

FAKE_FFMPEG = f"""#!{sys.executable}
import os, sys, time
args = sys.argv[1:]
log = os.environ.get("FAKE_FFMPEG_LOG")
if log:
    with open(log, "a") as f:
        f.write(" ".join(args) + "\\n")
url = args[args.index("-i") + 1]
if "pipe:1" in args:
    if "fail" in url:
        sys.stderr.write("rtsp://camuser:campass-test@10.0.0.9/x: Connection refused\\n")
        sys.exit(1)
    sys.stdout.buffer.write(b"\\xff\\xd8\\xff\\xe0fake-jpeg\\xff\\xd9")
    sys.exit(0)
if "barefail" in url:
    sys.stderr.write("auth rejected, password campass-test and campass%2Dtest\\n")
    sys.exit(1)
if "fail" in url:
    sys.stderr.write("[rtsp] Error opening input " + url + ": Connection refused\\n")
    sys.stderr.flush()
    sys.exit(1)
out = os.path.dirname(args[args.index("-hls_segment_filename") + 1])
with open(os.path.join(out, "seg-0.ts"), "wb") as f:
    f.write(b"\\x47" * 188)
with open(os.path.join(out, "index.m3u8"), "w") as f:
    f.write("#EXTM3U\\n#EXT-X-VERSION:3\\n#EXTINF:2.0,\\nseg-0.ts\\n")
time.sleep(3600)
"""


@pytest.fixture
def fake_ffmpeg(tmp_path: Path, monkeypatch) -> Path:
    script = tmp_path / "fake-ffmpeg"
    script.write_text(FAKE_FFMPEG)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("FAKE_FFMPEG_LOG", str(tmp_path / "calls.log"))
    return script


def calls(tmp_path: Path) -> list[str]:
    log = tmp_path / "calls.log"
    return log.read_text().splitlines() if log.exists() else []


# 假 ffprobe:按地址里的关键字打印固定 JSON。音频流排在前面,实现必须取第一个 *视频* 流
FAKE_FFPROBE = f"""#!{sys.executable}
import json, os, sys, time
args = sys.argv[1:]
log = os.environ.get("FAKE_FFPROBE_LOG")
if log:
    with open(log, "a") as f:
        f.write(" ".join(args) + "\\n")
url = args[args.index("-i") + 1]
if "brokenprobe" in url:  # 关键字不能含 fail:那是假 ffmpeg 截图失败的开关
    sys.stderr.write(url + ": Connection refused\\n")
    sys.exit(1)
if "badjson" in url:
    sys.stdout.write("{{not json")
    sys.exit(0)
if "slowprobe" in url:
    time.sleep(30)
if "hevc" in url:
    video = {{"codec_type": "video", "codec_name": "hevc", "width": 2560, "height": 1440,
             "r_frame_rate": "20/1"}}
    fmt = {{"filename": url, "bit_rate": "6000000"}}
elif "mpeg4" in url:
    video = {{"codec_type": "video", "codec_name": "mpeg4", "width": 704, "height": 576,
             "r_frame_rate": "0/0"}}
    fmt = {{"filename": url}}
else:
    video = {{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
             "r_frame_rate": "25/1", "bit_rate": "4096000"}}
    fmt = {{"filename": url, "bit_rate": "4200000"}}
streams = [{{"codec_type": "audio", "codec_name": "aac"}}, video]
print(json.dumps({{"streams": streams, "format": fmt}}))
"""


@pytest.fixture
def fake_ffprobe(tmp_path: Path, monkeypatch) -> Path:
    """放在假 ffmpeg 同目录、名字就叫 ffprobe:默认推导(同目录下的 ffprobe)能找到它。"""
    script = tmp_path / "ffprobe"
    script.write_text(FAKE_FFPROBE)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("FAKE_FFPROBE_LOG", str(tmp_path / "probe-calls.log"))
    return script


def probe_calls(tmp_path: Path) -> list[str]:
    log = tmp_path / "probe-calls.log"
    return log.read_text().splitlines() if log.exists() else []


@pytest.fixture
def hls_root(tmp_path: Path) -> Path:
    root = tmp_path / "hls"
    root.mkdir()
    return root


def make_camera(
    db: Session, url: str = "rtsp://10.0.0.5/live", *, enabled=True, creds=True, transcode=False
) -> Camera:
    cid = uuid4()
    cam = Camera(
        id=cid,
        school_id=UUID(SCHOOL_ID),
        name="测试摄像头",
        location="教室",
        rtsp_url=url,
        enabled=enabled,
        transcode=transcode,
        rtsp_username=crypto.encrypt(USER, KEY, aad=f"camera:{cid}:username") if creds else None,
        rtsp_password=crypto.encrypt(PASSWORD, KEY, aad=f"camera:{cid}:password")
        if creds
        else None,
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


_SUPERVISORS: list[Supervisor] = []


@pytest.fixture(autouse=True)
def _reap_children():
    """断言失败时 shutdown 可能没跑到:测试结束一律杀掉残留的假 ffmpeg 子进程。"""
    yield
    for sup in _SUPERVISORS:
        for st in sup._streams.values():
            if st.proc is not None and st.proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    os.kill(st.proc.pid, signal.SIGKILL)
    _SUPERVISORS.clear()


def make_supervisor(db, redis, fake, hls_root, **kw) -> Supervisor:
    @contextmanager
    def scope():
        yield db

    kw.setdefault("max_streams", 10)
    kw.setdefault("allow_loopback", False)
    sup = Supervisor(scope, redis, hls_root=hls_root, ffmpeg_bin=str(fake), master_key=KEY, **kw)
    _SUPERVISORS.append(sup)
    return sup


async def settle(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("条件在限定时间内没有满足")


async def want(redis, cam: Camera) -> None:
    await redis.set(f"{WANT_PREFIX}{cam.id}", "1", ex=30)


async def state(redis, cam: Camera) -> dict:
    return await redis.hgetall(f"{STATE_PREFIX}{cam.id}")


# ---------------- ffmpeg.py / lan.py ----------------


def test_build_args_copy_and_transcode(tmp_path):
    args = ffmpeg.build_args("rtsp://10.0.0.5/live", tmp_path, transcode=False)
    assert args[args.index("-i") + 1] == "rtsp://10.0.0.5/live"
    assert args[args.index("-rtsp_transport") + 1] == "tcp"
    assert args[args.index("-c:v") + 1] == "copy"
    assert "-an" in args
    assert args[args.index("-hls_time") + 1] == "2"
    assert args[args.index("-hls_list_size") + 1] == "6"
    flags = args[args.index("-hls_flags") + 1]
    assert flags == "delete_segments+independent_segments+discont_start"
    assert args[args.index("-start_number") + 1] == "0"
    assert args[args.index("-hls_segment_filename") + 1] == str(tmp_path / "seg-%d.ts")
    assert args[-1] == str(tmp_path / "index.m3u8")
    tc = ffmpeg.build_args("rtsp://10.0.0.5/live", tmp_path, transcode=True)
    assert tc[tc.index("-c:v") + 1] == "libx264"
    assert "scale=-2:720" in tc
    assert tc[tc.index("-g") + 1] == "50"
    # 资源围栏与兼容性:编码线程封顶、强制 yuv420p(浏览器不解 4:2:2 / 10bit);copy 模式不带
    assert tc[tc.index("-threads") + 1] == "2"
    assert tc[tc.index("-pix_fmt") + 1] == "yuv420p"
    assert tc.index("-i") < tc.index("-threads") < tc.index("-f")  # 作为输出选项,作用于编码器
    assert "-threads" not in args and "-pix_fmt" not in args


def test_credentials_url_encodes_and_mask_hides():
    url = ffmpeg.credentials_url("rtsp://10.0.0.5:8554/live?x=1", "cam user", "p@ss:/word")
    assert url == "rtsp://cam%20user:p%40ss%3A%2Fword@10.0.0.5:8554/live?x=1"
    masked = ffmpeg.mask_text(f"open {url} failed; password=hunter2&a=1", ("p@ss:/word",))
    assert "p%40ss" not in masked and "cam%20user" not in masked and "hunter2" not in masked
    assert "***" in masked


@pytest.mark.parametrize(
    "password",
    ["p/w", "p?w", "p#w", "p@w", "a/b?c#d@e", "p%2Fw", "p/w?x=1&y#f"],
)
def test_mask_text_password_with_url_delimiters(password):
    """L164:口令里带 / ? # @ 的地址(未编码地写进错误文本)也要整段打码,不能只打到第一个分隔符。"""
    url = f"rtsp://camuser:{password}@10.0.0.2:554/live?token=t1"
    for text in (url, f"[rtsp] Error opening {url}: Connection refused"):
        masked = ffmpeg.mask_text(text)
        assert password not in masked and "camuser" not in masked, masked
        assert "***@10.0.0.2:554/live" in masked and "t1" not in masked
    assert ffmpeg.mask_url(url) == "rtsp://***@10.0.0.2:554/live?token=***"
    # 没有 userinfo 的地址不受影响;文本里后面出现的 @ 不会把主机吞掉
    plain = "rtsp://10.0.0.2/live 失败,联系 admin@school"
    assert ffmpeg.mask_text(plain) == plain


def test_hls_flags_include_discont_start(tmp_path):
    """重启后的新播放列表首段带 #EXT-X-DISCONTINUITY,序列号从给定值接着编(不回退到 0)。"""
    for transcode in (False, True):
        args = ffmpeg.build_args(
            "rtsp://10.0.0.5/live", tmp_path, transcode=transcode, start_number=17623456
        )
        flags = args[args.index("-hls_flags") + 1].split("+")
        assert {"delete_segments", "independent_segments", "discont_start"} <= set(flags)
        assert args[args.index("-start_number") + 1] == "17623456"
        assert args.index("-f") < args.index("-start_number")  # 输出选项,放在 -f hls 之后


def test_ffprobe_args_and_bin():
    args = ffmpeg.ffprobe_args("rtsp://10.0.0.5/live")
    assert args[-2:] == ["-i", "rtsp://10.0.0.5/live"]
    assert args[args.index("-print_format") + 1] == "json"
    assert "-show_streams" in args and "-show_format" in args
    assert args[args.index("-rtsp_transport") + 1] == "tcp"
    assert args[args.index("-timeout") + 1] == ffmpeg.RTSP_IO_TIMEOUT_US
    assert args[args.index("-protocol_whitelist") + 1] == ffmpeg.PROTOCOL_WHITELIST
    assert args[args.index("-v") + 1] == "error"
    # ffprobe 与 ffmpeg 同目录;只给了名字时按 PATH 找
    assert ffmpeg.ffprobe_bin_for("/usr/bin/ffmpeg") == "/usr/bin/ffprobe"
    assert ffmpeg.ffprobe_bin_for("./bin/ffmpeg") == "./bin/ffprobe"
    assert ffmpeg.ffprobe_bin_for("ffmpeg") == "ffprobe"


@pytest.mark.parametrize(
    "codec, transcode, expected",
    [
        ("hevc", False, "H.265"),
        ("hevc", True, "已勾选转码"),
        ("mpeg4", False, "视频编码 mpeg4 浏览器不支持"),
        ("mjpeg", False, "视频编码 mjpeg 浏览器不支持"),
        ("mpeg4", True, None),
        ("h264", False, None),
        ("h264", True, None),
        (None, False, None),
    ],
)
def test_probe_hint(codec, transcode, expected):
    hint = probe.probe_hint(codec, transcode)
    if expected is None:
        assert hint is None
    else:
        assert hint is not None and expected in hint
    if codec == "hevc" and not transcode:
        assert "/Streaming/Channels/102" in hint and "subtype=1" in hint and "转码" in hint
    assert probe.browser_playable(codec, transcode) is (codec == "h264" or transcode)


def test_lan_rules(monkeypatch):
    assert lan.is_lan_ip("10.1.2.3") and lan.is_lan_ip("192.168.0.9") and lan.is_lan_ip("fd00::1")
    assert lan.is_lan_ip("169.254.1.1")
    assert not lan.is_lan_ip("8.8.8.8") and not lan.is_lan_ip("::ffff:8.8.8.8")
    assert not lan.is_lan_ip("127.0.0.1") and lan.is_lan_ip("127.0.0.1", allow_loopback=True)
    assert not lan.is_lan_ip("not-an-ip") and not lan.is_lan_ip(None)  # type: ignore[arg-type]
    # 文档段、0.0.0.0、CGNAT 都不是内网(ipaddress.is_private 会把前两类当私有)
    for bad in (
        "192.0.2.1",
        "198.51.100.1",
        "203.0.113.7",
        "0.0.0.0",
        "0.0.0.1",
        "100.64.0.1",
        "2001:db8::1",
    ):
        assert not lan.is_lan_ip(bad), bad

    def fake_gai(host, *a, **k):
        return {
            "mixed.example.test": [(2, 1, 6, "", ("10.0.0.5", 0)), (2, 1, 6, "", ("8.8.8.8", 0))],
            "lan.example.test": [(2, 1, 6, "", ("10.0.0.5", 0))],
        }.get(host) or (_ for _ in ()).throw(socket.gaierror())

    monkeypatch.setattr(backend_lan, "socket", SimpleNamespace(getaddrinfo=fake_gai))
    assert lan.resolve_is_lan("lan.example.test")
    assert not lan.resolve_is_lan("mixed.example.test")  # 任一结果在公网就拒绝
    assert not lan.resolve_is_lan("nx.example.test")  # 解析失败即拒绝
    assert not lan.resolve_is_lan("")


# ---------------- 假 ffmpeg 组 ----------------


def test_starts_on_want(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await sup.tick(0)  # 没人想看:不起进程
        assert calls(tmp_path) == []
        await want(redis, cam)
        await sup.tick(1)
        await settle(lambda: (hls_root / str(cam.id) / "index.m3u8").exists())
        await sup.tick(2)
        st = await state(redis, cam)
        assert st["status"] == "streaming" and st["last_error"] == ""
        assert len(calls(tmp_path)) == 1
        # 凭据只传给 ffmpeg 进程
        assert "camuser:campass-test@10.0.0.5" in calls(tmp_path)[0]
        await sup.tick(3)  # 再 tick 不重复起
        assert len(calls(tmp_path)) == 1
        await sup.shutdown()

    run_async(redis_url, body)


def test_idle_stop(db, redis_url, fake_ffmpeg, hls_root):
    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        await settle(lambda: (hls_root / str(cam.id) / "index.m3u8").exists())
        proc = sup._streams[cam.id].proc
        await redis.delete(f"{WANT_PREFIX}{cam.id}")  # want 过期
        await sup.tick(2)
        assert proc.returncode is not None
        assert not (hls_root / str(cam.id)).exists()
        assert (await state(redis, cam))["status"] == "idle"
        assert not sup._streams

    run_async(redis_url, body)


def test_max_streams(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    cams = [make_camera(db) for _ in range(3)]

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root, max_streams=2)
        for c in cams:
            await want(redis, c)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 2)
        states = [
            (await state(redis, c)).get("last_error") for c in sorted(cams, key=lambda c: str(c.id))
        ]
        assert len(calls(tmp_path)) == 2
        assert states.count("busy") == 1
        busy = None
        for c in cams:
            if (await state(redis, c)).get("last_error") == "busy":
                busy = c
        assert (await state(redis, busy))["status"] == "error"
        # 已在跑的不受影响;腾出名额后下一轮就起
        running = next(c for c in cams if c is not busy)
        await redis.delete(f"{WANT_PREFIX}{running.id}")
        await sup.tick(2)
        await settle(lambda: len(calls(tmp_path)) == 3)
        assert (await state(redis, busy))["last_error"] == ""
        await sup.shutdown()

    run_async(redis_url, body)


def test_backoff_on_failure(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    cam = make_camera(db, "rtsp://10.0.0.5/fail")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)

        async def exits() -> None:
            st = sup._streams[cam.id]
            await settle(lambda: st.proc is not None and st.proc.returncode is not None)

        await sup.tick(100)  # 第 1 次启动
        await exits()
        await sup.tick(100.1)  # 发现退出:错误状态,5 秒后才重启
        assert (await state(redis, cam))["status"] == "error"
        await sup.tick(104.9)
        assert len(calls(tmp_path)) == 1  # 5 秒内不重启
        await sup.tick(105.2)  # 第 2 次启动
        await exits()
        await sup.tick(105.3)  # 第二次失败:间隔 10 秒
        await sup.tick(115.2)
        assert len(calls(tmp_path)) == 2
        await sup.tick(115.4)
        await settle(lambda: len(calls(tmp_path)) == 3)
        await exits()
        await sup.tick(115.5)  # 第三次失败:间隔 30 秒
        await sup.tick(145.0)
        assert len(calls(tmp_path)) == 3
        await sup.shutdown()

    run_async(redis_url, body)


def _start_numbers(tmp_path: Path) -> list[int]:
    out = []
    for line in calls(tmp_path):
        argv = line.split(" ")
        out.append(int(argv[argv.index("-start_number") + 1]))
    return out


def test_start_number_increases_across_restarts(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    """每次重启按墙上秒数起编:序列号只增不减、不与上一轮重叠;7 位起编,离白名单的 8 位还有余量。"""
    cam = make_camera(db, "rtsp://10.0.0.5/fail")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(100)
        st = sup._streams[cam.id]
        await settle(lambda: st.proc is not None and st.proc.returncode is not None)
        await sup.tick(100.1)
        await sup.tick(105.2)  # 退避 5 秒后第二次启动
        await settle(lambda: len(calls(tmp_path)) == 2)
        first, second = _start_numbers(tmp_path)
        assert second >= first
        assert 0 <= first <= 9_999_999 and 0 <= second <= 9_999_999  # 7 位起编,给 8 位白名单留余量
        assert abs(first - int(time.time()) % 10**7) < 60  # 来源是墙上秒数(mod 1e7)
        assert st.start_number == second
        await sup.shutdown()

    run_async(redis_url, body)


def test_stall_restarts_stream(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    """播放列表超过 STALL_SECONDS 没更新:收掉进程、清目录、按正常退避重连;稳定运行后退避仍重置。"""
    from app.stream import supervisor as supervisor_mod

    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        index = hls_root / str(cam.id) / "index.m3u8"
        await settle(index.exists)
        await sup.tick(2)
        st = sup._streams[cam.id]
        assert st.status == "streaming"
        proc = st.proc
        st.fail_count = 3  # 假装之前失败过多次:跑满 STABLE_AFTER 后停更,退避仍从 5 秒重来
        stale = time.time() - (supervisor_mod.STALL_SECONDS + 5)
        os.utime(index, (stale, stale))
        now = 1 + supervisor_mod.STABLE_AFTER + 1
        await sup.tick(now)
        assert proc.returncode is not None  # 进程被收掉
        assert st.proc is None and not (hls_root / str(cam.id)).exists()
        s = await state(redis, cam)
        assert s["status"] == "error" and "停止更新" in s["last_error"]
        assert round(st.next_retry_at - now) == 5
        assert len(calls(tmp_path)) == 1  # 退避期内不重启
        await sup.tick(now + 5.1)
        await settle(lambda: len(calls(tmp_path)) == 2)
        await settle(index.exists)
        await sup.tick(now + 6)
        assert (await state(redis, cam))["status"] == "streaming"
        await sup.shutdown()

    run_async(redis_url, body)


def test_no_stall_while_fresh(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    from app.stream import supervisor as supervisor_mod

    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        index = hls_root / str(cam.id) / "index.m3u8"
        await settle(index.exists)
        await sup.tick(2)
        st = sup._streams[cam.id]
        proc = st.proc
        for t in (3, 60, 600):  # tick 的单调时钟走多久都无所谓,看的是播放列表的 mtime
            await sup.tick(t)
        assert st.proc is proc and proc.returncode is None and st.status == "streaming"
        # 刚好不到阈值也不算停更
        edge = time.time() - (supervisor_mod.STALL_SECONDS - 3)
        os.utime(index, (edge, edge))
        await sup.tick(601)
        assert st.proc is proc and proc.returncode is None and st.status == "streaming"
        assert len(calls(tmp_path)) == 1
        await sup.shutdown()

    run_async(redis_url, body)


def test_stall_threshold_follows_target_duration(
    db, redis_url, fake_ffmpeg, hls_root, tmp_path, caplog
):
    """copy 模式下播放列表更新周期 = GOP:阈值 = 3 × TARGETDURATION 夹在 [30, 120],不误杀长 GOP。"""
    from app.stream import supervisor as supervisor_mod

    caplog.set_level(logging.WARNING, logger="app.stream")
    cam = make_camera(db)

    def age(index: Path, seconds: float) -> None:
        old = time.time() - seconds
        os.utime(index, (old, old))

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        index = hls_root / str(cam.id) / "index.m3u8"
        await settle(index.exists)
        await sup.tick(2)
        st = sup._streams[cam.id]
        proc = st.proc
        # 关键帧间隔 20 秒的摄像头:ffmpeg 写出 TARGETDURATION:20,阈值 60 秒
        index.write_text(
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20.0,\nseg-0.ts\n"
        )
        age(index, 45)
        await sup.tick(3)
        assert st.proc is proc and proc.returncode is None and st.status == "streaming"
        assert "stream stalled" not in caplog.text
        age(index, 61)
        await sup.tick(4)
        assert proc.returncode is not None and st.proc is None and st.status == "error"
        assert "停止更新" in st.last_error
        # 首次判定时 warning 里写出观测到的停更秒数与阈值
        assert "stream stalled" in caplog.text
        assert "playlist_age=61s" in caplog.text and "threshold=60s" in caplog.text
        # 短 GOP 不会把阈值压到 30 秒以下;播放列表不见了也算停更
        index.parent.mkdir(exist_ok=True)
        index.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:2.0,\nseg-0.ts\n")
        age(index, 25)
        assert sup._stalled(cam.id) is None
        age(index, 31)
        assert sup._stalled(cam.id) == (pytest.approx(31, abs=2), 30)
        # 时间戳跳变会让 ffmpeg 写出巨大的 TARGETDURATION:阈值封顶 120 秒,看门狗不能被关掉
        index.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:999\n#EXTINF:2.0,\nseg-0.ts\n")
        age(index, 110)
        assert sup._stalled(cam.id) is None
        age(index, 121)
        assert sup._stalled(cam.id) == (pytest.approx(121, abs=2), 120)
        # 非正整数 / 解析不了都回退下限 30
        for bad in ("0", "-5", "9" * 5000):
            assert supervisor_mod._stall_threshold(f"#EXTM3U\n#EXT-X-TARGETDURATION:{bad}\n") == 30
        assert supervisor_mod._stall_threshold("#EXTM3U\n#EXT-X-TARGETDURATION:abc\n") == 30
        assert supervisor_mod._stall_threshold("#EXTM3U\n#EXT-X-VERSION:3\n") == 30
        index.unlink()
        assert sup._stalled(cam.id) == (None, 30)
        await sup.shutdown()

    run_async(redis_url, body)


def test_reload_restarts(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        old = sup._streams[cam.id].proc
        cam.rtsp_url = "rtsp://10.0.0.6/live"
        db.flush()
        await sup.handle_reload(cam.id)
        assert old.returncode is not None
        await sup.tick(2)
        await settle(lambda: len(calls(tmp_path)) == 2)
        assert "10.0.0.6" in calls(tmp_path)[1]
        await sup.shutdown()

    run_async(redis_url, body)


def test_worker_refuses_public_host(db, redis_url, fake_ffmpeg, hls_root, tmp_path, monkeypatch):
    literal = make_camera(db, "rtsp://8.8.8.8/live")
    mapped = make_camera(db, "rtsp://[::ffff:8.8.8.8]/live")
    named = make_camera(db, "rtsp://cam.example.test/live")
    loop = make_camera(db, "rtsp://127.0.0.1/live")
    real_gai = socket.getaddrinfo

    def fake_gai(host, *a, **k):  # 只伪造这一个名字;IP 字面量走真实实现(不联网)
        if host == "cam.example.test":
            return [(2, 1, 6, "", ("203.0.113.7", 0))]
        return real_gai(host, *a, **k)

    monkeypatch.setattr(backend_lan, "socket", SimpleNamespace(getaddrinfo=fake_gai))

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        for c in (literal, mapped, named, loop):
            await want(redis, c)
        await sup.tick(1)
        assert calls(tmp_path) == []  # 一个进程都没起
        for c in (literal, mapped, named, loop):
            st = await state(redis, c)
            assert st["status"] == "error" and "内网" in st["last_error"], (c.rtsp_url, st)
        hosts = json.loads(await redis.get(PUBLIC_HOSTS_KEY) or "null")
        assert hosts is None  # 自检只在 run() / reload 时写
        assert sorted(await sup.refresh_public_hosts()) == sorted(
            ["8.8.8.8", "::ffff:8.8.8.8", "cam.example.test", "127.0.0.1"]
        )
        # 开发环境放行回环,其余仍拒绝
        dev = make_supervisor(db, redis, fake_ffmpeg, hls_root, allow_loopback=True)
        await redis.delete(*[f"{WANT_PREFIX}{c.id}" for c in (literal, mapped, named)])
        await dev.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        await dev.shutdown()

    run_async(redis_url, body)


def _fake_dns(monkeypatch, table: dict[str, str]) -> None:
    """只伪造表里的名字;IP 字面量走真实实现(不联网)。"""
    real_gai = socket.getaddrinfo

    def fake_gai(host, *a, **k):
        if host in table:
            return [(2, 1, 6, "", (table[host], 0))]
        return real_gai(host, *a, **k)

    monkeypatch.setattr(backend_lan, "socket", SimpleNamespace(getaddrinfo=fake_gai))


def test_stream_url_pins_resolved_ip(db, monkeypatch):
    """L155:拉流地址里的主机换成判定过的 IP(仅 rtsp://),ffmpeg 不再自己解析一次(DNS 重绑定)。"""
    _fake_dns(monkeypatch, {"cam.example.test": "10.0.0.9"})
    row = source._row(make_camera(db, "rtsp://cam.example.test:554/live?x=1"))
    ip = asyncio.run(source.resolve_lan(row, allow_loopback=False))
    assert ip == "10.0.0.9"
    url, secrets = source.stream_url(row, KEY, pin_ip=ip)
    assert url == f"rtsp://{USER}:{PASSWORD}@10.0.0.9:554/live?x=1"
    assert url in secrets
    # IPv6 结果加方括号;不钉(None)就是原样
    assert source.stream_url(row, KEY, pin_ip="fd00::9")[0] == (
        f"rtsp://{USER}:{PASSWORD}@[fd00::9]:554/live?x=1"
    )
    assert (
        source.stream_url(row, KEY)[0] == f"rtsp://{USER}:{PASSWORD}@cam.example.test:554/live?x=1"
    )
    # rtsps:// 保留主机名(TLS 证书按主机名校验),判定照样做
    srow = source._row(make_camera(db, "rtsps://cam.example.test/live"))
    assert asyncio.run(source.resolve_lan(srow, allow_loopback=False)) == "10.0.0.9"
    assert source.stream_url(srow, KEY, pin_ip="10.0.0.9")[0] == (
        f"rtsps://{USER}:{PASSWORD}@cam.example.test/live"
    )
    # 不是内网 / 解析失败 → None
    _fake_dns(monkeypatch, {"cam.example.test": "203.0.113.7"})
    assert asyncio.run(source.resolve_lan(row, allow_loopback=False)) is None
    nx = source._row(make_camera(db, "rtsp://nx.example.test/live"))
    monkeypatch.setattr(
        backend_lan,
        "socket",
        SimpleNamespace(getaddrinfo=lambda *a, **k: (_ for _ in ()).throw(socket.gaierror())),
    )
    assert asyncio.run(source.resolve_lan(nx, allow_loopback=False)) is None


def test_worker_and_probe_use_pinned_ip(
    db, redis_url, fake_ffmpeg, fake_ffprobe, hls_root, tmp_path, monkeypatch
):
    _fake_dns(monkeypatch, {"cam.example.test": "10.0.0.9"})
    cam = make_camera(db, "rtsp://cam.example.test/live")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        argv = calls(tmp_path)[0]
        assert f"-i rtsp://{USER}:{PASSWORD}@10.0.0.9/live" in argv
        assert "cam.example.test" not in argv
        await sup.shutdown()
        r, raw = await _ask(redis, db, cam, fake_ffmpeg)
        assert r["ok"] is True
        (probe_argv,) = probe_calls(tmp_path)
        assert "@10.0.0.9/live" in probe_argv and "cam.example.test" not in probe_argv
        assert PASSWORD not in raw and "10.0.0.9" not in raw  # 回写里没有地址,更没有凭据

    run_async(redis_url, body)


def test_worker_refuses_trusted_network_host(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    """L159:worker 与保存时同口径——解析到可信代理 / compose 子网的地址拒绝拉流、进自检名单。"""
    denied = [ipaddress.ip_network("172.30.0.0/24")]
    inside = make_camera(db, "rtsp://172.30.0.5:5432/x")
    ok = make_camera(db, "rtsp://192.168.1.10/live")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root, denied_networks=denied)
        await want(redis, inside)
        await want(redis, ok)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        assert "192.168.1.10" in calls(tmp_path)[0] and "172.30.0.5" not in calls(tmp_path)[0]
        st = await state(redis, inside)
        assert st["status"] == "error" and "内网" in st["last_error"]
        assert await sup.refresh_public_hosts() == ["172.30.0.5"]
        await sup.shutdown()
        key = f"{probe.REPLY_PREFIX}denied"

        @contextmanager
        def scope():
            yield db

        await probe.handle_probe(
            json.dumps({"id": str(inside.id), "reply_key": key}),
            redis,
            scope,
            ffmpeg_bin=str(fake_ffmpeg),
            master_key=KEY,
            allow_loopback=False,
            denied_networks=denied,
        )
        r = json.loads(await redis.get(key))
        assert r["ok"] is False and "内网" in r["message"]
        assert len(calls(tmp_path)) == 1  # 没有为它起过 ffmpeg
        # 没配拒绝网段(开发环境)时 172.30.0.5 只是普通私网地址
        plain = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        assert await plain.refresh_public_hosts() == []

    run_async(redis_url, body)


def test_logs_mask_credentials(db, redis_url, fake_ffmpeg, hls_root, caplog):
    cam = make_camera(db, "rtsp://10.0.0.5/fail")
    caplog.set_level(logging.DEBUG)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        st = sup._streams[cam.id]
        await settle(lambda: st.proc.returncode is not None)
        await sup.tick(2)
        last_error = (await state(redis, cam))["last_error"]
        assert "***" in last_error
        assert USER not in last_error and PASSWORD not in last_error
        everything = json.dumps(await redis.hgetall(f"{STATE_PREFIX}{cam.id}"))
        assert PASSWORD not in everything and USER not in everything

    run_async(redis_url, body)
    assert PASSWORD not in caplog.text and USER not in caplog.text
    assert "***" in caplog.text


def test_empty_start(db, redis_url, fake_ffmpeg, hls_root):
    """空库起步:没有摄像头、没有 want 键:空转,public_hosts 写 []。"""

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        assert await sup.refresh_public_hosts() == []
        assert await redis.get(PUBLIC_HOSTS_KEY) == "[]"
        await sup.tick(1)
        await sup.shutdown()
        # run() 起得来并能被停掉
        task = asyncio.create_task(sup.run())
        await asyncio.sleep(0.3)
        sup.request_stop()
        await asyncio.wait_for(task, 5)

    run_async(redis_url, body)


def test_probe_reply(db, redis_url, fake_ffmpeg):
    ok = make_camera(db)
    bad = make_camera(db, "rtsp://10.0.0.5/fail")
    public = make_camera(db, "rtsp://8.8.8.8/live")

    @contextmanager
    def scope():
        yield db

    async def ask(redis, cam_id, key) -> dict:
        await probe.handle_probe(
            json.dumps({"id": str(cam_id), "reply_key": key}),
            redis,
            scope,
            ffmpeg_bin=str(fake_ffmpeg),
            master_key=KEY,
            allow_loopback=False,
        )
        return json.loads(await redis.get(key))

    async def body(redis):
        r = await ask(redis, ok.id, f"{probe.REPLY_PREFIX}a")
        assert r["ok"] and base64.b64decode(r["preview_jpeg_base64"]).startswith(b"\xff\xd8")
        assert r["probe"] is None  # 同目录下没有 ffprobe:只少编解码信息,截图照常
        r = await ask(redis, bad.id, f"{probe.REPLY_PREFIX}b")
        assert not r["ok"] and r["preview_jpeg_base64"] is None
        assert PASSWORD not in r["message"] and USER not in r["message"]
        r = await ask(redis, public.id, f"{probe.REPLY_PREFIX}c")
        assert not r["ok"] and "内网" in r["message"]
        # reply_key 不在约定前缀下:不写
        await probe.handle_probe(
            json.dumps({"id": str(ok.id), "reply_key": "ws:cam:want:evil"}),
            redis,
            scope,
            ffmpeg_bin=str(fake_ffmpeg),
            master_key=KEY,
            allow_loopback=False,
        )
        assert await redis.get("ws:cam:want:evil") is None

    run_async(redis_url, body)


async def _ask(redis, db, cam: Camera, fake_ffmpeg: Path, **kw) -> tuple[dict, str]:
    """跑一次测试连接,返回(结果字典, Redis 里的原始 JSON 文本)。"""

    @contextmanager
    def scope():
        yield db

    key = f"{probe.REPLY_PREFIX}{cam.id}"
    await probe.handle_probe(
        json.dumps({"id": str(cam.id), "reply_key": key}),
        redis,
        scope,
        ffmpeg_bin=str(fake_ffmpeg),
        master_key=KEY,
        allow_loopback=False,
        **kw,
    )
    raw = await redis.get(key)
    return json.loads(raw), raw


def test_probe_reports_hevc_not_playable(db, redis_url, fake_ffmpeg, fake_ffprobe, tmp_path):
    """红队场景:H.265 主码流截图成功,但未转码时浏览器放不了——结果里要说清楚。"""
    cam = make_camera(db, "rtsp://10.0.0.5/hevc/main")

    async def body(redis):
        r, raw = await _ask(redis, db, cam, fake_ffmpeg)  # 不传 ffprobe_bin:按 ffmpeg 同目录推导
        assert r["ok"] is True and r["message"] == "连接成功"
        assert base64.b64decode(r["preview_jpeg_base64"]).startswith(b"\xff\xd8")
        assert r["probe"] == {
            "video_codec": "hevc",
            "width": 2560,
            "height": 1440,
            "fps": 20.0,
            "bitrate_kbps": 6000,  # 流级没有码率:取 format.bit_rate
            "audio_codec": "aac",
            "browser_playable": False,
            "hint": r["probe"]["hint"],
        }
        hint = r["probe"]["hint"]
        assert "H.265" in hint and "/Streaming/Channels/102" in hint and "转码" in hint
        # ffprobe 的参数与 ffmpeg 同一套网络约束;凭据只进子进程,不进 Redis
        (argv,) = probe_calls(tmp_path)
        assert "-rtsp_transport tcp" in argv and f"-timeout {ffmpeg.RTSP_IO_TIMEOUT_US}" in argv
        assert f"-protocol_whitelist {ffmpeg.PROTOCOL_WHITELIST}" in argv
        assert "-print_format json" in argv and "-show_streams" in argv
        assert f"rtsp://{USER}:{PASSWORD}@10.0.0.5/hevc/main" in argv
        assert PASSWORD not in raw and USER not in raw

    run_async(redis_url, body)


def test_probe_hevc_with_transcode_playable(db, redis_url, fake_ffmpeg, fake_ffprobe):
    cam = make_camera(db, "rtsp://10.0.0.5/hevc", transcode=True)

    async def body(redis):
        r, _ = await _ask(redis, db, cam, fake_ffmpeg, ffprobe_bin=str(fake_ffprobe))
        assert r["ok"] is True
        assert r["probe"]["video_codec"] == "hevc"
        assert r["probe"]["browser_playable"] is True
        assert r["probe"]["hint"] == probe.probe_hint("hevc", True)
        assert "已勾选转码" in r["probe"]["hint"]

    run_async(redis_url, body)


def test_probe_h264_no_hint(db, redis_url, fake_ffmpeg, fake_ffprobe):
    h264 = make_camera(db)
    mpeg4 = make_camera(db, "rtsp://10.0.0.5/mpeg4")

    async def body(redis):
        r, _ = await _ask(redis, db, h264, fake_ffmpeg)
        assert r["ok"] is True
        assert r["probe"] == {
            "video_codec": "h264",
            "width": 1920,
            "height": 1080,
            "fps": 25.0,
            "bitrate_kbps": 4096,  # 流级码率优先于 format.bit_rate
            "audio_codec": "aac",
            "browser_playable": True,
            "hint": None,
        }
        # 分母为 0 的帧率、没有码率 → null;非 h264 又没转码 → 不可播 + 提示
        r, _ = await _ask(redis, db, mpeg4, fake_ffmpeg)
        assert r["probe"]["video_codec"] == "mpeg4"
        assert r["probe"]["fps"] is None and r["probe"]["bitrate_kbps"] is None
        assert r["probe"]["browser_playable"] is False
        assert "mpeg4" in r["probe"]["hint"]

    run_async(redis_url, body)


@pytest.mark.parametrize("path", ["brokenprobe", "badjson", "slowprobe", "noprobe"])
def test_probe_failure_keeps_grab_result(
    db, redis_url, fake_ffmpeg, fake_ffprobe, tmp_path, monkeypatch, caplog, path
):
    """ffprobe 退出非 0 / 输出不是 JSON / 超时 / 没有可执行文件:probe 为 null,截图结果不受影响。"""
    monkeypatch.setattr(probe, "FFPROBE_TIMEOUT", 0.5)
    caplog.set_level(logging.DEBUG)
    good = make_camera(db, f"rtsp://10.0.0.5/{path}")
    bad = make_camera(db, f"rtsp://10.0.0.5/fail/{path}")
    kw = {"ffprobe_bin": str(tmp_path / "missing-ffprobe")} if path == "noprobe" else {}

    async def body(redis):
        started = time.monotonic()
        r, raw = await _ask(redis, db, good, fake_ffmpeg, **kw)
        assert time.monotonic() - started < 5  # 超时的 ffprobe 不拖慢整体
        assert r["ok"] is True and r["probe"] is None
        assert base64.b64decode(r["preview_jpeg_base64"]).startswith(b"\xff\xd8")
        assert PASSWORD not in raw and USER not in raw
        r, raw = await _ask(redis, db, bad, fake_ffmpeg, **kw)
        assert r["ok"] is False and r["probe"] is None and r["preview_jpeg_base64"] is None
        assert PASSWORD not in raw and USER not in raw

    run_async(redis_url, body)
    assert PASSWORD not in caplog.text and USER not in caplog.text


def test_probe_unexpected_exception_keeps_grab_result(
    db, redis_url, fake_ffmpeg, fake_ffprobe, monkeypatch, caplog
):
    """ffprobe 分支里冒出没预料到的异常:probe 为 null、截图结果照常,不能变成"测试失败"。"""
    caplog.set_level(logging.WARNING, logger="app.stream")

    def boom(_data):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(probe, "parse_ffprobe", boom)
    cam = make_camera(db, "rtsp://10.0.0.5/hevc")

    async def body(redis):
        r, _ = await _ask(redis, db, cam, fake_ffmpeg)
        assert r["ok"] is True and r["message"] == "连接成功" and r["probe"] is None
        assert base64.b64decode(r["preview_jpeg_base64"]).startswith(b"\xff\xd8")

    run_async(redis_url, body)
    assert "ffprobe crashed: RuntimeError" in caplog.text


# ---------------- 真 ffmpeg 组 ----------------

RTSP_PORT = int(os.environ.get("WS_RTSP_PORT", "8554"))


def _fake_camera_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", RTSP_PORT), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture
def real_ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if binary is None:
        pytest.skip("本机没有 ffmpeg")
    if not _fake_camera_up():
        pytest.skip(f"假摄像头没有在 127.0.0.1:{RTSP_PORT} 监听(docker compose --profile camera)")
    return binary


@pytest.mark.ffmpeg
def test_real_ffmpeg_produces_hls(db, redis_url, real_ffmpeg, hls_root):
    cam = make_camera(db, f"rtsp://127.0.0.1:{RTSP_PORT}/cam1", creds=False)

    async def body(redis):
        sup = make_supervisor(db, redis, real_ffmpeg, hls_root, allow_loopback=True)
        await want(redis, cam)
        await sup.tick(1)
        out = hls_root / str(cam.id)
        # 首片段最多等 20 秒:CI runner 上 ffmpeg 冷启动 + 2 秒切片可能超过产品侧 8 秒的 503 契约,
        # 这里只验证"真 ffmpeg 能出 HLS",不复验那个契约
        await settle(lambda: (out / "index.m3u8").exists() and any(out.glob("seg-*.ts")), 20)
        await sup.tick(2)
        assert (await state(redis, cam))["status"] == "streaming"
        await sup.shutdown()
        assert not out.exists()

    run_async(redis_url, body)


@pytest.mark.ffmpeg
def test_real_ffmpeg_probe_returns_jpeg(db, redis_url, real_ffmpeg):
    cam = make_camera(db, f"rtsp://127.0.0.1:{RTSP_PORT}/cam1", creds=False)

    @contextmanager
    def scope():
        yield db

    async def body(redis):
        key = f"{probe.REPLY_PREFIX}real"
        await probe.handle_probe(
            json.dumps({"id": str(cam.id), "reply_key": key}),
            redis,
            scope,
            ffmpeg_bin=real_ffmpeg,
            master_key=KEY,
            allow_loopback=True,
        )
        result = json.loads(await redis.get(key))
        assert result["ok"], result
        assert base64.b64decode(result["preview_jpeg_base64"]).startswith(b"\xff\xd8")

    run_async(redis_url, body)


# ---------------- 终审补充 ----------------


def test_mask_text_bare_and_encoded_secrets():
    """不含 URL 的裸口令、只以百分号编码形式出现的口令也要打码(不能只靠 userinfo 正则)。"""
    text = "auth rejected, password campass-test and cam%20user%21"
    masked = ffmpeg.mask_text(text, ("campass-test", "cam user!"))
    assert "campass-test" not in masked and "cam%20user" not in masked


def test_bare_password_in_stderr_is_masked(db, redis_url, fake_ffmpeg, hls_root):
    cam = make_camera(db, "rtsp://10.0.0.5/barefail")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        st = sup._streams[cam.id]
        await settle(lambda: st.proc.returncode is not None)
        await sup.tick(2)
        err = (await state(redis, cam))["last_error"]
        assert PASSWORD not in err and "***" in err

    run_async(redis_url, body)


def test_backoff_caps_at_60_and_resets_after_stable_run(
    db, redis_url, fake_ffmpeg, hls_root, tmp_path
):
    cam = make_camera(db, "rtsp://10.0.0.5/fail")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        t = 1000.0
        delays = []
        for _ in range(6):
            await sup.tick(t)  # 启动
            st = sup._streams[cam.id]
            await settle(lambda s=st: s.proc.returncode is not None)
            await sup.tick(t)  # 发现退出
            delays.append(round(st.next_retry_at - t))
            t = st.next_retry_at + 0.1
        assert delays == [5, 10, 30, 60, 60, 60]
        # 运行满 30 秒后再退出,算新的一轮失败,退避从 5 秒重新开始
        st.fail_count = 4
        await sup.tick(t)
        await settle(lambda: st.proc is not None and st.proc.returncode is not None)
        await sup.tick(t + 31)
        assert round(st.next_retry_at - (t + 31)) == 5
        await sup.shutdown()

    run_async(redis_url, body)


def test_one_bad_camera_does_not_block_others(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    bad = make_camera(db, "rtsp://10.0.0.5:99999/x")  # 端口非法:拼凭据地址时抛 ValueError
    good = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, bad)
        await want(redis, good)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        assert (await state(redis, bad))["status"] == "error"
        assert sup._streams[good.id].proc is not None
        await sup.shutdown()

    run_async(redis_url, body)


def test_reset_states_and_clear_hls_on_start(db, redis_url, fake_ffmpeg, hls_root):
    """worker 重启:上个进程留下的 state 与 hls 目录都清掉。"""
    stale = uuid4()
    (hls_root / str(stale)).mkdir()
    (hls_root / str(stale) / "seg-0.ts").write_bytes(b"x")

    async def body(redis):
        await redis.hset(f"{STATE_PREFIX}{stale}", mapping={"status": "streaming"})
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        task = asyncio.create_task(sup.run())
        await settle(lambda: not (hls_root / str(stale)).exists())
        assert await redis.exists(f"{STATE_PREFIX}{stale}") == 0
        sup.request_stop()
        await asyncio.wait_for(task, 5)

    run_async(redis_url, body)


def test_reload_message_stops_stream(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    """走真实的 ws:cam:reload 订阅路径(不是直接调 handle_reload)。"""
    cam = make_camera(db)

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        await settle(lambda: len(calls(tmp_path)) == 1)
        old = sup._streams[cam.id].proc
        task = asyncio.create_task(sup._reload_loop())
        for _ in range(50):  # 等订阅建立
            await redis.publish("ws:cam:reload", str(cam.id))
            if old.returncode is not None:
                break
            await asyncio.sleep(0.1)
        assert old.returncode is not None
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    run_async(redis_url, body)


def test_non_rtsp_scheme_refused(db, redis_url, fake_ffmpeg, hls_root, tmp_path):
    cam = make_camera(db, "http://10.0.0.5/live.m3u8")

    async def body(redis):
        sup = make_supervisor(db, redis, fake_ffmpeg, hls_root)
        await want(redis, cam)
        await sup.tick(1)
        assert calls(tmp_path) == []
        assert (await state(redis, cam))["status"] == "error"

    run_async(redis_url, body)
