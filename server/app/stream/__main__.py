"""python -m app.stream:启动转流 supervisor 与测试连接循环。"""

import asyncio
import json
import logging
import os
import signal
import sys
from pathlib import Path

from redis.asyncio import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.stream import ffmpeg
from app.stream.probe import probe_loop
from app.stream.supervisor import Supervisor

HEARTBEAT = Path(os.environ.get("WS_STREAM_HEARTBEAT", "/tmp/ws-stream-alive"))  # noqa: S108
REDIS_TIMEOUT = 5  # 秒:连接与单次读写的上限


def make_redis(url: str) -> Redis:
    """worker 的 Redis 客户端带超时(L196):Redis 挂住时 tick 抛 TimeoutError 被主循环当作一次失败
    告警、心跳继续,而不是永久等待。pubsub 的 listen() 在 redis-py 8 里显式不受 socket_timeout 约束,
    空闲的 reload 订阅不会被误判成断线(test_reload_loop_idle_with_socket_timeout 钉住这一点)。"""
    return Redis.from_url(
        url,
        decode_responses=True,
        socket_timeout=REDIS_TIMEOUT,
        socket_connect_timeout=REDIS_TIMEOUT,
    )


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "ts": self.formatTime(record),
                "level": record.levelname,
                "logger": record.name,
                "msg": record.getMessage(),
            },
            ensure_ascii=False,
        )


async def main() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    logging.basicConfig(level=settings.log_level.upper(), handlers=[handler])
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    factory = sessionmaker(bind=engine)
    redis = make_redis(settings.redis_url)
    allow_loopback = settings.env == "dev"
    ffmpeg_bin = os.environ.get("WS_FFMPEG_BIN", "ffmpeg")
    ffprobe_bin = ffmpeg.ffprobe_bin_for(ffmpeg_bin)  # 测试连接读编解码信息用,与 ffmpeg 同目录
    supervisor = Supervisor(
        factory,
        redis,
        hls_root=settings.hls_root,
        max_streams=settings.stream_max,
        ffmpeg_bin=ffmpeg_bin,
        master_key=settings.master_key_bytes,
        allow_loopback=allow_loopback,
        denied_networks=settings.trusted_networks,
    )
    stop = asyncio.Event()

    def request_stop() -> None:
        stop.set()
        supervisor.request_stop()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, request_stop)
    probe_task = asyncio.create_task(
        probe_loop(
            redis,
            factory,
            ffmpeg_bin=ffmpeg_bin,
            master_key=settings.master_key_bytes,
            allow_loopback=allow_loopback,
            stop=stop,
            ffprobe_bin=ffprobe_bin,
            denied_networks=settings.trusted_networks,
        )
    )
    try:
        await supervisor.run(HEARTBEAT)
    finally:
        stop.set()
        await probe_task
        await redis.aclose()
        engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
