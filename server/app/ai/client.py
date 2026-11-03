import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import structlog

log = structlog.get_logger()


@dataclass
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass
class Delta:
    text: str


@dataclass
class Usage:
    prompt_tokens: int | None
    completion_tokens: int | None


class AIUpstreamError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _upstream() -> AIUpstreamError:
    return AIUpstreamError("AI_UPSTREAM", "AI 服务暂时出错了,请稍后再试")


def _unreachable() -> AIUpstreamError:
    return AIUpstreamError("AI_UNREACHABLE", "连不上 AI 服务,请稍后再试或联系学校管理员")


def _status_error(status: int) -> AIUpstreamError:
    if status in (401, 403):
        return AIUpstreamError(
            "AI_KEY_INVALID", "AI 服务的 API Key 无效或没有权限,请联系学校管理员"
        )
    if status == 404:
        return AIUpstreamError("AI_MODEL_NOT_FOUND", "AI 服务地址或模型名不对,请联系学校管理员")
    if status == 402:
        return AIUpstreamError("AI_QUOTA", "AI 服务余额不足,请联系学校管理员")
    if status == 429:
        return AIUpstreamError("AI_RATE_LIMITED", "AI 服务请求太频繁或额度用完了,请稍后再试")
    return _upstream()


def _usage(data: Any) -> Usage | None:
    u = data.get("usage") if isinstance(data, dict) else None
    if not isinstance(u, dict):
        return None
    return Usage(u.get("prompt_tokens"), u.get("completion_tokens"))


class OpenAICompatClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        temperature: float,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 60.0,
    ):
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._transport = transport
        self._timeout = timeout

    async def stream(
        self, messages: list[ChatMessage], *, max_tokens: int | None = None
    ) -> AsyncIterator[Delta | Usage]:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "temperature": self._temperature,
            "stream_options": {"include_usage": True},
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as http:
                async with http.stream("POST", self._url, json=body, headers=headers) as resp:
                    if resp.status_code != 200:
                        raw = await resp.aread()
                        log.warning(
                            "ai_upstream_error",
                            status=resp.status_code,
                            body=raw.decode(errors="replace")[:200],
                        )
                        raise _status_error(resp.status_code)
                    if "application/json" in resp.headers.get("content-type", ""):
                        async for item in self._parse_json(await resp.aread()):
                            yield item
                    else:
                        async for item in self._parse_sse(resp):
                            yield item
        except httpx.TransportError as e:
            raise _unreachable() from e

    async def _parse_json(self, raw: bytes) -> AsyncIterator[Delta | Usage]:
        try:
            data = json.loads(raw)
            text = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise _upstream() from e
        if text:
            yield Delta(text)
        yield _usage(data) or Usage(None, None)

    async def _parse_sse(self, resp: httpx.Response) -> AsyncIterator[Delta | Usage]:
        usage: Usage | None = None
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
            except ValueError as e:
                raise _upstream() from e
            u = _usage(data)
            if u is not None:
                usage = u
            choices = data.get("choices") if isinstance(data, dict) else None
            if choices:
                text = (choices[0].get("delta") or {}).get("content")
                if text:
                    yield Delta(text)
        yield usage or Usage(None, None)
