"""假的 OpenAI 兼容服务商:测试一律走 httpx.MockTransport,绝不碰真实网络。"""

import json
from collections.abc import AsyncIterator

import httpx


def _event(payload: dict) -> bytes:
    return b"data: " + json.dumps(payload, ensure_ascii=False).encode() + b"\n\n"


def sse_transport(
    chunks: list[str],
    *,
    usage: tuple[int, int] | None = (12, 34),
    status: int = 200,
    record: list[dict] | None = None,
    fail_after: int | None = None,
) -> httpx.MockTransport:
    async def body() -> AsyncIterator[bytes]:
        for i, text in enumerate(chunks, start=1):
            yield _event({"choices": [{"delta": {"content": text}}]})
            if fail_after is not None and i == fail_after:
                raise httpx.ReadError("connection dropped")
        if usage is not None:
            yield _event(
                {
                    "choices": [],
                    "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
                }
            )
        yield b"data: [DONE]\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        if record is not None:
            record.append(json.loads(request.content))
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "x"}})
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())

    return httpx.MockTransport(handler)
