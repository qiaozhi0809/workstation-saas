import asyncio
import json
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select

from app.ai.client import AIUpstreamError, ChatMessage, Delta, OpenAICompatClient, Usage
from app.ai.providers import PRESETS, provider_label
from app.ai.settings import (
    AIConfig,
    clear_ai_config,
    is_ready,
    load_ai_config,
    make_client,
    save_ai_config,
)
from app.models import SchoolSetting
from tests.fake_llm import sse_transport
from tests.seed_ids import SCHOOL_ID

KEY = b"x" * 32
SID = UUID(SCHOOL_ID)
MSGS = [ChatMessage("user", "hi")]


def client(transport, temperature: float = 0.7, api_key: str | None = "test-key"):
    return OpenAICompatClient(
        base_url="https://llm.example.test/v1/",
        api_key=api_key,
        model="m1",
        temperature=temperature,
        transport=transport,
    )


def collect(c: OpenAICompatClient, messages: list[ChatMessage], **kw):
    async def run():
        return [x async for x in c.stream(messages, **kw)]

    return asyncio.run(run())


def test_streams_deltas_and_usage():
    out = collect(client(sse_transport(["你好", "老师"])), MSGS)
    assert [d.text for d in out if isinstance(d, Delta)] == ["你好", "老师"]
    assert out[-1] == Usage(12, 34)


def test_sends_openai_body_and_auth():
    rec: list[dict] = []
    seen: list[httpx.Request] = []

    inner = sse_transport(["x"], record=rec)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return inner.handler(request)

    collect(client(httpx.MockTransport(handler), temperature=0.3), MSGS, max_tokens=50)
    assert rec[0]["stream"] is True and rec[0]["temperature"] == 0.3
    assert rec[0]["stream_options"] == {"include_usage": True}
    assert rec[0]["model"] == "m1" and rec[0]["max_tokens"] == 50
    assert rec[0]["messages"] == [{"role": "user", "content": "hi"}]
    assert str(seen[0].url) == "https://llm.example.test/v1/chat/completions"
    assert seen[0].headers["authorization"] == "Bearer test-key"


def test_no_key_no_auth_header_no_max_tokens():
    rec: list[dict] = []
    seen: list[httpx.Request] = []
    inner = sse_transport(["x"], record=rec)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return inner.handler(request)

    collect(client(httpx.MockTransport(handler), api_key=None), MSGS)
    assert "authorization" not in seen[0].headers
    assert "max_tokens" not in rec[0]


def test_json_response_without_stream():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "整段回答"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 4},
            },
        )

    out = collect(client(httpx.MockTransport(handler)), MSGS)
    assert out == [Delta("整段回答"), Usage(3, 4)]


def test_usage_missing_yields_none_usage():
    out = collect(client(sse_transport(["a"], usage=None)), MSGS)
    assert out[-1] == Usage(None, None)


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "AI_KEY_INVALID"),
        (403, "AI_KEY_INVALID"),
        (404, "AI_MODEL_NOT_FOUND"),
        (402, "AI_QUOTA"),
        (429, "AI_RATE_LIMITED"),
        (502, "AI_UPSTREAM"),
    ],
)
def test_http_errors_map(status, code):
    with pytest.raises(AIUpstreamError) as ei:
        collect(client(sse_transport(["a"], status=status)), MSGS)
    assert ei.value.code == code
    assert '"message"' not in ei.value.message


def test_connect_error_maps_to_unreachable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(AIUpstreamError) as ei:
        collect(client(httpx.MockTransport(handler)), MSGS)
    assert ei.value.code == "AI_UNREACHABLE"
    assert ei.value.message == "连不上 AI 服务,请稍后再试或联系学校管理员"


def test_bad_json_body_maps_to_upstream():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "application/json"}, content=b"{oops")

    with pytest.raises(AIUpstreamError) as ei:
        collect(client(httpx.MockTransport(handler)), MSGS)
    assert ei.value.code == "AI_UPSTREAM"


def test_mid_stream_failure_keeps_earlier_deltas_then_unreachable():
    c = client(sse_transport(["一", "二"], fail_after=1))
    got: list = []

    async def run():
        async for x in c.stream(MSGS):
            got.append(x)

    with pytest.raises(AIUpstreamError) as ei:
        asyncio.run(run())
    assert got == [Delta("一")]
    assert ei.value.code == "AI_UNREACHABLE"


def test_presets_and_label():
    assert list(PRESETS) == ["deepseek", "qwen", "kimi", "glm", "doubao", "silicon", "custom"]
    assert provider_label("deepseek", "deepseek-flash") == "DeepSeek · deepseek-flash"
    assert provider_label("custom", "foo") == "自定义 · foo"


def test_save_and_load_config_encrypts_key(db):
    cfg = AIConfig(
        "deepseek", "https://api.deepseek.com", "deepseek-flash", 0.7, "sk-test-0000", False
    )
    save_ai_config(db, SID, KEY, cfg)
    raw = db.scalar(select(SchoolSetting.value).where(SchoolSetting.key == "ai"))
    assert "sk-test-0000" not in json.dumps(raw)
    assert raw["api_key_enc"]
    assert load_ai_config(db, SID, KEY) == cfg
    # overwrite (upsert) and no-key variant
    save_ai_config(db, SID, KEY, AIConfig("custom", "http://127.0.0.1:1/v1", "m", 0.2, None, True))
    got = load_ai_config(db, SID, KEY)
    assert got.api_key is None and got.mask_forced is True and got.provider == "custom"
    clear_ai_config(db, SID)
    assert load_ai_config(db, SID, KEY) is None


def test_is_ready():
    ok = AIConfig("deepseek", "https://api.deepseek.com", "m", 0.7, "k", False)
    assert is_ready(ok)
    assert not is_ready(None)
    assert not is_ready(AIConfig("deepseek", "https://api.deepseek.com", "m", 0.7, None, False))
    assert is_ready(AIConfig("custom", "http://127.0.0.1:18089/v1", "m", 0.7, None, False))
    assert is_ready(AIConfig("custom", "http://localhost:11434/v1", "m", 0.7, None, False))
    assert not is_ready(AIConfig("custom", "http://127.0.0.1:18089/v1", "", 0.7, None, False))
    assert not is_ready(AIConfig("custom", "", "m", 0.7, "k", False))


def test_make_client_uses_config():
    cfg = AIConfig("deepseek", "https://api.deepseek.com", "m", 0.5, "k", False)
    out = collect(make_client(cfg, sse_transport(["ok"])), MSGS)
    assert out[0] == Delta("ok")
