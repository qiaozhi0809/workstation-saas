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
import re
import secrets
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any
from uuid import UUID

import anyio
import anyio.to_thread
import httpx
import structlog
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, update
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.ai.chats import chat_items, ordered_messages
from app.ai.client import AIUpstreamError, ChatMessage, Delta, Usage
from app.ai.context import system_prompt
from app.ai.masking import Masker, defuse_codes, masker_for_school, scrub
from app.ai.requests import Job, build_job
from app.ai.settings import AIConfig, make_client
from app.ai.templates import TEMPLATES
from app.db import SessionScope
from app.domain.ai.schemas import AiReplyIn
from app.domain.schools.service import active_academic_year, school_today
from app.errors import ApiError
from app.models import AiBatchItem, AiChat, AiMessage, SchoolClass, Student, User
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings

log = structlog.get_logger()

LOCK_TTL = 300
UNLOCK_ATTEMPTS = 3
UNLOCK_RETRY_SECONDS = 0.5
GENERIC_ERROR = "生成出错了,请稍后再试"
SAVE_ERROR = "生成结果没能保存,请重新生成"

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
    lock_token: str


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
    """只产出 delta 事件;结局记在 ``state``(done / error),终结事件由 ``generation_events``
    在落库、释放锁之后再发,这样前端收到 done / error 时数据与锁都已就绪。"""
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
    else:
        state.status = "done"
    tail = restorer.flush()
    if tail:
        yield sse("delta", {"text": tail})


def _final_event(state: GenState) -> bytes:
    if state.status == "error":
        return sse("error", {"code": state.error_code, "message": state.error})
    return sse("done", {"status": state.status})


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
    if prep is None:
        # 还没进入生成(取第一口之前就断开 / prepare 自己失败):没有要写的行,也不记审计(L248)
        return
    with ctx.scope() as s:
        try:
            save(s, prep, state)
            s.flush()
        except Exception:
            log.exception("ai_save_failed", chat_id=str(ctx.chat_id))
            s.rollback()
            # 结果没存下来就不能对前端说 done:事件、审计都按出错;再试一次把行标为失败,
            # 别把它留在 streaming / run("生成中")
            state.status, state.error_code, state.error = "error", "AI_SAVE_FAILED", SAVE_ERROR
            try:
                save(s, prep, state)
                s.flush()
            except Exception:
                log.exception("ai_save_failed_again", chat_id=str(ctx.chat_id))
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
                    "template": prep.template,
                    "student_ids": prep.student_ids,
                    "provider": ctx.cfg.provider,
                    "model": ctx.cfg.model,
                    "masked": prep.masked,
                    "outcome": state.status,
                    "prompt_tokens": state.prompt_tokens,
                    "completion_tokens": state.completion_tokens,
                    "chars_in": prep.chars_in,
                    "chars_out": len(state.raw),
                },
            )
        )
        s.commit()


async def _unlock(ctx: GenContext) -> None:
    """释放对话锁;Redis 暂时不可用就重试几次,仍失败只记日志——结局已经落库,
    不能因为放锁失败对前端改口,锁最晚随 LOCK_TTL 过期。"""
    for attempt in range(1, UNLOCK_ATTEMPTS + 1):
        try:
            await anyio.to_thread.run_sync(
                partial(release_lock, ctx.redis, ctx.lock_key, ctx.lock_token)
            )
            return
        except RedisError:
            if attempt == UNLOCK_ATTEMPTS:
                log.exception("ai_unlock_failed", chat_id=str(ctx.chat_id), attempts=attempt)
            else:
                await anyio.sleep(UNLOCK_RETRY_SECONDS)


async def _finalize_and_unlock(
    ctx: GenContext,
    prep: Prepared | None,
    state: GenState,
    save: Callable[[Session, Prepared, GenState], None],
) -> None:
    with anyio.CancelScope(shield=True):
        try:
            await anyio.to_thread.run_sync(partial(_finalize, ctx, prep, state, save))
        finally:
            await _unlock(ctx)


async def generation_events(
    ctx: GenContext,
    prepare: Callable[[Session], Prepared],
    save: Callable[[Session, Prepared, GenState], None],
) -> AsyncGenerator[bytes]:
    state = GenState()
    prep: Prepared | None = None
    finalized = False
    try:
        prep = await anyio.to_thread.run_sync(partial(_run_prepare, ctx, prepare))
        yield sse("meta", prep.meta)
        inner = stream_provider(ctx, prep, state)
        async with contextlib.aclosing(inner):
            async for chunk in inner:
                yield chunk
        # 先落库、释放锁,再告诉前端结束了
        finalized = True
        await _finalize_and_unlock(ctx, prep, state, save)
        yield _final_event(state)
    except (GeneratorExit, anyio.get_cancelled_exc_class()):
        if state.status == "streaming":
            state.status = "stopped"
        raise
    except Exception:
        log.exception("ai_generation_failed", chat_id=str(ctx.chat_id))
        state.status, state.error_code, state.error = "error", "AI_UPSTREAM", GENERIC_ERROR
        if not finalized:
            finalized = True
            await _finalize_and_unlock(ctx, prep, state, save)
        yield _final_event(state)
    finally:
        if not finalized:
            await _finalize_and_unlock(ctx, prep, state, save)


# ---------------------------------------------------------------- SSE 响应


class _Started:
    __slots__ = ("value",)

    def __init__(self) -> None:
        self.value = False


async def _guarded(events: AsyncGenerator[bytes], started: _Started) -> AsyncIterator[bytes]:
    started.value = True
    async with contextlib.aclosing(events):
        async for chunk in events:
            yield chunk


class GenerationResponse(StreamingResponse):
    """生成用的 SSE 响应。正常收尾、中途停止 / 断开都由 ``generation_events`` 自己落库放锁;
    这里只兜"生成器一次都没开始迭代"的情况——响应头发不出去(ASGI 2.4 服务器 send 抛
    OSError)或在取第一口之前就被取消——那时生成器的 finally 根本不会跑,锁要等 LOCK_TTL
    才过期,新一次生成会一直撞 AI_BUSY。"""

    def __init__(self, ctx: GenContext, events: AsyncGenerator[bytes]) -> None:
        self._ctx = ctx
        self._started = _Started()
        super().__init__(
            _guarded(events, self._started),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            if not self._started.value:
                with anyio.CancelScope(shield=True):
                    await _unlock(self._ctx)


# ---------------------------------------------------------------- reply


def _outgoing(masker: Masker, mask: bool, text: str, *, fresh: bool = False) -> str:
    """``fresh``:老师刚输入的文本,手写编号先破坏掉(见 ``defuse_codes``)。"""
    text = scrub(text)
    if fresh:
        text = defuse_codes(text)
    return masker.mask(text) if mask else text


def _history_user(masker: Masker, mask: bool, text: str) -> str:
    """历史用户消息:``sent`` 已脱敏,先认下其中生成过的编号,再对遗留真名补脱。"""
    text = scrub(text)
    if not mask:
        return text
    masker.adopt(text)
    return masker.mask(text)


def prepare_reply(s: Session, ctx: GenContext, body: AiReplyIn) -> Prepared:
    chat = s.get(AiChat, ctx.chat_id)
    user = s.get(User, ctx.user_id)
    cls = s.get(SchoolClass, chat.class_id) if chat else None
    if chat is None or user is None or cls is None:
        raise ApiError(404, "NOT_FOUND", "对话不存在")
    year = active_academic_year(s, user.school_id)
    bindings = load_bindings(s, user.id, year.id if year else None)
    masker = masker_for_school(s, cls.school_id, cls.id)
    mask = chat.mask or ctx.cfg.mask_forced

    if body.text is not None:
        s.add(
            AiMessage(
                chat_id=chat.id,
                role="user",
                content=body.text,
                sent=_outgoing(masker, mask, body.text, fresh=True),
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
            content = _history_user(masker, mask, m.sent if m.sent is not None else m.content)
            messages.append(ChatMessage("user", content))
        elif m.content:
            messages.append(ChatMessage("assistant", _outgoing(masker, mask, m.content)))
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
        masked=mask,
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


def reply_events(ctx: GenContext, body: AiReplyIn) -> AsyncGenerator[bytes]:
    return generation_events(ctx, partial(prepare_reply, ctx=ctx, body=body), save_reply)


# ---------------------------------------------------------------- 批量条目

_NOTE_N = re.compile(r"(\d+)")


def build_item_job(
    s: Session,
    user: User,
    cls: SchoolClass,
    chat: AiChat,
    item: AiBatchItem,
    *,
    mask: bool,
    masker: Masker | None = None,
) -> Job:
    """按对话参数和当下数据重建某一条的 prompt;学生已不在本班时抛 400 AI_FIELD_INVALID。

    批量时调用方传同一个 ``masker``(只建一次,也让换回认得已生成的编号)。
    """
    masker = masker or masker_for_school(s, cls.school_id, cls.id)
    template = TEMPLATES.get(chat.template_id) if chat.template_id else None
    year = active_academic_year(s, user.school_id)
    bindings = load_bindings(s, user.id, year.id if year else None)
    student = s.get(Student, item.student_id)
    if template is None or student is None:
        raise ApiError(404, "NOT_FOUND", "条目不存在")
    found = _NOTE_N.search(item.note or "")
    try:
        return build_job(
            s, user, bindings, cls, template, chat.params, student, school_today(s, cls.school_id),
            masked=mask, masker=masker,
            regress_n=int(found.group(1)) if found else None,
        )  # fmt: skip
    except ApiError as e:
        if e.code == "AI_FIELD_INVALID" and (e.details or {}).get("field") == "student":
            raise ApiError(400, "AI_FIELD_INVALID", "学生已不在本班", {"field": "students"}) from e
        raise


def prepare_item(s: Session, ctx: GenContext, item_id: UUID) -> Prepared:
    chat = s.get(AiChat, ctx.chat_id)
    user = s.get(User, ctx.user_id)
    cls = s.get(SchoolClass, chat.class_id) if chat else None
    item = s.get(AiBatchItem, item_id)
    if chat is None or user is None or cls is None or item is None or item.chat_id != chat.id:
        raise ApiError(404, "NOT_FOUND", "条目不存在")
    mask = chat.mask or ctx.cfg.mask_forced
    masker = masker_for_school(s, cls.school_id, cls.id)
    job = build_item_job(s, user, cls, chat, item, mask=mask, masker=masker)
    year = active_academic_year(s, user.school_id)
    bindings = load_bindings(s, user.id, year.id if year else None)
    system = scrub(system_prompt(s, user, bindings, cls))
    messages = [ChatMessage("system", system), ChatMessage("user", job.sent)]
    item.status, item.content, item.error = "run", "", None
    s.flush()
    return Prepared(
        meta={"item_id": str(item.id)},
        messages=messages,
        masker=masker,
        target_id=item.id,
        template=chat.template_id,
        student_ids=[str(item.student_id)],
        masked=mask,
        chars_in=sum(len(m.content) for m in messages),
    )


def save_item(s: Session, prep: Prepared, state: GenState) -> None:
    item = s.get(AiBatchItem, prep.target_id)
    if item is None:  # 生成期间对话被删
        return
    if state.status == "done":
        item.status, item.content, item.error = "done", prep.masker.restore(state.raw), None
    elif state.status == "error":
        item.status, item.content, item.error = "err", "", state.error or GENERIC_ERROR
    else:  # stopped / 断开:回到待生成
        item.status, item.content, item.error = "wait", "", None


def run_item_events(ctx: GenContext, item_id: UUID) -> AsyncGenerator[bytes]:
    return generation_events(ctx, partial(prepare_item, ctx=ctx, item_id=item_id), save_item)


__all__ = [
    "GenContext",
    "GenState",
    "GenerationResponse",
    "Prepared",
    "acquire_lock",
    "generation_events",
    "lock_key",
    "release_lock",
    "reply_events",
    "run_item_events",
    "sse",
    "stream_provider",
]
