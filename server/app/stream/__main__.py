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
from app.stream.probe import probe_loop
from app.stream.supervisor import Supervisor

HEARTBEAT = Path(os.environ.get("WS_STREAM_HEARTBEAT", "/tmp/ws-stream-alive"))  # noqa: S108


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
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    allow_loopback = settings.env == "dev"
    ffmpeg_bin = os.environ.get("WS_FFMPEG_BIN", "ffmpeg")
    supervisor = Supervisor(
        factory,
        redis,
        hls_root=settings.hls_root,
        max_streams=settings.stream_max,
        ffmpeg_bin=ffmpeg_bin,
        master_key=settings.master_key_bytes,
        allow_loopback=allow_loopback,
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
