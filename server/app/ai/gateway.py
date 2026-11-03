"""AI 生成的流式网关:并发锁、SSE 事件、停止 / 断开 / 出错时的落库与审计。

可复用的核心(批量逐条生成也走这里):
- ``generation_events(ctx, prepare, save)``:完整生命周期。
  ``prepare(session) -> Prepared`` 在线程池里建好待写的行、重建 prompt;
  ``save(session, prepared, state)`` 在 ``finally`` 里写最终内容。
  审计、更新对话时间、提交、释放锁都由它统一处理。
- ``stream_provider(ctx, prepared, state)``:只负责读服务商流并产出 delta / done / error 事件。
"""

import contextlib
import json
import secrets
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any
from uuid import UUID

import anyio
import anyio.to_thread
import httpx
import structlog
from redis import Redis
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.ai.chats import chat_items, ordered_messages
from app.ai.client import AIUpstreamError, ChatMessage, Delta, Usage
from app.ai.context import system_prompt
from app.ai.masking import Masker, masker_for_class, scrub
from app.ai.settings import AIConfig, make_client
from app.db import SessionScope
from app.domain.ai.schemas import AiReplyIn
from app.domain.schools.service import active_academic_year
from app.errors import ApiError
from app.models import AiChat, AiMessage, SchoolClass, User
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings

log = structlog.get_logger()

LOCK_TTL = 300
GENERIC_ERROR = "生成出错了,请稍后再试"

_RELEASE = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then "
    "return redis.call('del', KEYS[1]) else return 0 end"
)


@dataclass
class GenContext:
    chat_id: UUID
    user_id: UUID
    school_id: UUID
    class_id: UUID
    cfg: AIConfig
    transport: httpx.AsyncBaseTransport | None
    scope: SessionScope
    redis: Redis
    lock_key: str
    ip: str | None
    user_agent: str | None
    lock_token: str = ""


@dataclass
class Prepared:
    meta: dict[str, Any]  # 作为 meta 事件发出
    messages: list[ChatMessage]  # 发给服务商的全部消息(含系统提示)
    masker: Masker
    target_id: UUID  # 要写结果的行(助手消息 / 批量条目)
    template: str | None
    student_ids: list[str]
    masked: bool
    chars_in: int


@dataclass
class GenState:
    raw: str = ""  # 服务商原文(含编号)
    status: str = "streaming"  # streaming → done | stopped | error
    error_code: str | None = None
    error: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def lock_key(chat_id: UUID | str) -> str:
    return f"ai:chat:{chat_id}"


def acquire_lock(redis: Redis, chat_id: UUID | str) -> str:
    """拿到返回随机令牌;拿不到抛 409 AI_BUSY。"""
    token = secrets.token_hex(16)
    if not redis.set(lock_key(chat_id), token, nx=True, ex=LOCK_TTL):
        raise ApiError(409, "AI_BUSY", "这个对话正在生成,请稍候")
    return token


def release_lock(redis: Redis, key: str, token: str) -> None:
    """仅当锁还是自己的才删。"""
    redis.eval(_RELEASE, 1, key, token)


# ---------------------------------------------------------------- 流式核心


async def stream_provider(ctx: GenContext, prep: Prepared, state: GenState) -> AsyncIterator[bytes]:
    client = make_client(ctx.cfg, ctx.transport)
    restorer = prep.masker.restorer()
    try:
        async with contextlib.aclosing(client.stream(prep.messages)) as it:
            async for ev in it:
                if isinstance(ev, Delta):
                    state.raw += ev.text
                    out = restorer.feed(ev.text)
                    if out:
                        yield sse("delta", {"text": out})
                elif isinstance(ev, Usage):
                    state.prompt_tokens = ev.prompt_tokens
                    state.completion_tokens = ev.completion_tokens
    except AIUpstreamError as e:
        state.status, state.error_code, state.error = "error", e.code, e.message
        tail = restorer.flush()
        if tail:
            yield sse("delta", {"text": tail})
        yield sse("error", {"code": e.code, "message": e.message})
        return
    state.status = "done"
    tail = restorer.flush()
    if tail:
        yield sse("delta", {"text": tail})
    yield sse("done", {"status": "done"})


# ---------------------------------------------------------------- 生命周期


def _run_prepare(ctx: GenContext, prepare: Callable[[Session], Prepared]) -> Prepared:
    with ctx.scope() as s:
        prep = prepare(s)
        s.commit()
        return prep


def _finalize(
    ctx: GenContext,
    prep: Prepared | None,
    state: GenState,
    save: Callable[[Session, Prepared, GenState], None],
) -> None:
    with ctx.scope() as s:
        if prep is not None:
            try:
                save(s, prep, state)
                s.flush()
            except Exception:
                log.exception("ai_save_failed", chat_id=str(ctx.chat_id))
                s.rollback()
        s.execute(
            update(AiChat).where(AiChat.id == ctx.chat_id).values(updated_at=func.clock_timestamp())
        )
        s.add(
            AuditLog(
                user_id=ctx.user_id,
                action="ai.generate",
                success=state.status != "error",
                object_type="ai_chat",
                object_id=str(ctx.chat_id),
                ip=ctx.ip,
                user_agent=ctx.user_agent,
                extra={
                    "template": prep.template if prep else None,
                    "student_ids": prep.student_ids if prep else [],
                    "provider": ctx.cfg.provider,
                    "model": ctx.cfg.model,
                    "masked": prep.masked if prep else False,
                    "outcome": state.status,
                    "prompt_tokens": state.prompt_tokens,
                    "completion_tokens": state.completion_tokens,
                    "chars_in": prep.chars_in if prep else 0,
                    "chars_out": len(state.raw),
                },
            )
        )
        s.commit()


async def generation_events(
    ctx: GenContext,
    prepare: Callable[[Session], Prepared],
    save: Callable[[Session, Prepared, GenState], None],
) -> AsyncIterator[bytes]:
    state = GenState()
    prep: Prepared | None = None
    try:
        prep = await anyio.to_thread.run_sync(partial(_run_prepare, ctx, prepare))
        yield sse("meta", prep.meta)
        inner = stream_provider(ctx, prep, state)
        async with contextlib.aclosing(inner):
            async for chunk in inner:
                yield chunk
    except (GeneratorExit, anyio.get_cancelled_exc_class()):
        if state.status == "streaming":
            state.status = "stopped"
        raise
    except Exception:
        log.exception("ai_generation_failed", chat_id=str(ctx.chat_id))
        state.status, state.error_code, state.error = "error", "AI_UPSTREAM", GENERIC_ERROR
        yield sse("error", {"code": state.error_code, "message": GENERIC_ERROR})
    finally:
        with anyio.CancelScope(shield=True):
            try:
                await anyio.to_thread.run_sync(partial(_finalize, ctx, prep, state, save))
            finally:
                await anyio.to_thread.run_sync(
                    partial(release_lock, ctx.redis, ctx.lock_key, ctx.lock_token)
                )


# ---------------------------------------------------------------- reply


def _outgoing(masker: Masker, mask: bool, text: str) -> str:
    text = scrub(text)
    return masker.mask(text) if mask else text


def prepare_reply(s: Session, ctx: GenContext, body: AiReplyIn) -> Prepared:
    chat = s.get(AiChat, ctx.chat_id)
    user = s.get(User, ctx.user_id)
    cls = s.get(SchoolClass, chat.class_id) if chat else None
    if chat is None or user is None or cls is None:
        raise ApiError(404, "NOT_FOUND", "对话不存在")
    year = active_academic_year(s, user.school_id)
    bindings = load_bindings(s, user.id, year.id if year else None)
    masker = masker_for_class(s, cls.id)

    if body.text is not None:
        s.add(
            AiMessage(
                chat_id=chat.id,
                role="user",
                content=body.text,
                sent=_outgoing(masker, chat.mask, body.text),
                status="done",
            )
        )
        s.flush()
    elif body.regenerate:
        existing = ordered_messages(s, chat.id)
        if existing and existing[-1].role == "assistant":
            s.delete(existing[-1])
            s.flush()

    assistant = AiMessage(chat_id=chat.id, role="assistant", content="", status="streaming")
    s.add(assistant)
    s.flush()

    system = scrub(system_prompt(s, user, bindings, cls))
    messages = [ChatMessage("system", system)]
    for m in ordered_messages(s, chat.id):
        if m.id == assistant.id:
            continue
        if m.role == "user":
            content = m.sent if m.sent is not None else _outgoing(masker, chat.mask, m.content)
            messages.append(ChatMessage("user", content))
        elif m.content:
            messages.append(ChatMessage("assistant", _outgoing(masker, chat.mask, m.content)))
    student_ids = (
        [str(chat.student_id)]
        if chat.student_id
        else [str(sid) for sid in _item_students(s, chat.id)]
    )
    return Prepared(
        meta={"message_id": str(assistant.id)},
        messages=messages,
        masker=masker,
        target_id=assistant.id,
        template=chat.template_id,
        student_ids=student_ids,
        masked=chat.mask,
        chars_in=sum(len(m.content) for m in messages),
    )


def _item_students(s: Session, chat_id: UUID) -> list[UUID]:
    return [i.student_id for i in chat_items(s, chat_id)]


def save_reply(s: Session, prep: Prepared, state: GenState) -> None:
    msg = s.get(AiMessage, prep.target_id)
    if msg is None:  # 生成期间对话被删
        return
    msg.content = prep.masker.restore(state.raw)
    msg.status = state.status if state.status in ("done", "stopped", "error") else "error"
    msg.error = state.error if msg.status == "error" else None
    msg.prompt_tokens = state.prompt_tokens
    msg.completion_tokens = state.completion_tokens


def reply_events(ctx: GenContext, body: AiReplyIn) -> AsyncIterator[bytes]:
    return generation_events(ctx, partial(prepare_reply, ctx=ctx, body=body), save_reply)


__all__ = [
    "GenContext",
    "GenState",
    "Prepared",
    "acquire_lock",
    "generation_events",
    "lock_key",
    "release_lock",
    "reply_events",
    "sse",
    "stream_provider",
]
