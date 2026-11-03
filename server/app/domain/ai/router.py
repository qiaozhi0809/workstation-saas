import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from redis import Redis
from sqlalchemy.orm import Session

from app import clock
from app.ai.chats import (
    chat_items,
    chat_out,
    create_chat,
    delete_chat,
    get_own_chat,
    list_chats,
    ordered_messages,
)
from app.ai.context import system_prompt
from app.ai.gateway import GenContext, acquire_lock, lock_key, release_lock, reply_events
from app.ai.masking import masker_for_class, scrub
from app.ai.providers import provider_label
from app.ai.requests import (
    Job,
    Resolved,
    _check_perms,
    build_job,
    combined_prompt,
    effective_default,
    field_defaults,
    resolve,
)
from app.ai.settings import is_ready, load_ai_config
from app.ai.templates import CATEGORIES, PERM_ORDER, TEMPLATES
from app.audit.service import record
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import SessionScope, get_db, session_scope
from app.domain.ai.schemas import (
    AiCategory,
    AiChatList,
    AiChatOut,
    AiField,
    AiMapping,
    AiPrompt,
    AiReplyIn,
    AiRequestIn,
    AiStatus,
    AiTemplate,
    AiTemplates,
)
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.schools.service import school_today
from app.errors import ApiError
from app.models import Student, User
from app.rbac.bindings import Binding, can
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm
from app.redis import get_redis

router = APIRouter(prefix="/ai", tags=["ai"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]
RedisDep = Annotated[Redis, Depends(get_redis)]
ScopeDep = Annotated[SessionScope, Depends(session_scope)]


@router.get("/status", response_model=AiStatus)
def ai_status(db: DbDep, _user: UserDep, settings: SettingsDep) -> AiStatus:
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    configured = is_ready(cfg)
    return AiStatus(
        configured=configured,
        provider_label=provider_label(cfg.provider, cfg.model) if configured and cfg else None,
        mask_forced=cfg.mask_forced if cfg else False,
    )


_REASONS = {
    Perm.AI_CLASS: "仅班主任可用",
    Perm.COMMENT_WRITE: "仅班主任可用",
    Perm.EXAM_READ: "需要查看成绩的权限",
}


@router.get("/templates", response_model=AiTemplates, response_model_exclude_unset=True)
def ai_templates(
    class_id: UUID,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
) -> AiTemplates:
    cls = get_class_or_404(db, class_id)
    scope = class_scope_of(cls)
    ensure(db, request, user.id, bindings, Perm.AI_USE, scope, object_id=str(cls.id))
    defaults = field_defaults(db, bindings, cls)
    items = []
    for t in TEMPLATES.values():
        missing = next(
            (p for p in PERM_ORDER if p in t.needs and not can(bindings, p, scope)), None
        )
        fields = []
        for f in t.fields:
            extra: dict = {}
            default = effective_default(f, defaults)
            if f.options is not None:
                extra["options"] = list(f.options)
            if default is not None:
                extra["default"] = default
            if f.placeholder is not None:
                extra["placeholder"] = f.placeholder
            fields.append(
                AiField(key=f.key, type=f.type, label=f.label, required=f.required, **extra)
            )
        items.append(
            AiTemplate(
                id=t.id,
                cat=t.cat,
                title=t.title,
                desc=t.desc,
                rec=t.rec,
                hidden=t.hidden,
                batch=t.batch,
                fields=fields,
                available=missing is None,
                unavailable_reason=_REASONS.get(missing) if missing else None,
            )
        )
    return AiTemplates(categories=[AiCategory(id=i, label=n) for i, n in CATEGORIES], items=items)


@router.post("/prompt", response_model=AiPrompt)
def ai_prompt(
    body: AiRequestIn,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
    settings: SettingsDep,
) -> AiPrompt:
    cls = get_class_or_404(db, body.class_id)
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    today = school_today(db, cls.school_id)
    r = resolve(db, user, bindings, cls, body, cfg, today, request=request)
    prompt = combined_prompt(r)
    mapping = r.masker.mapping("\n".join(j.sent for j in r.jobs)) if r.masked else []
    student_ids = list(dict.fromkeys(sid for j in r.jobs for sid in j.student_ids))
    record(
        db,
        user_id=user.id,
        action="ai.prompt_copy",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={
            "template": r.template.id if r.template else None,
            "student_ids": [str(s) for s in student_ids],
            "masked": r.masked,
            "chars_in": len(prompt),
            "chars_out": 0,
        },
    )
    db.commit()
    return AiPrompt(prompt=prompt, mapping=[AiMapping(code=c, name=n) for c, n in mapping])


# ---------------------------------------------------------------- 对话


@router.post("/chats", response_model=AiChatOut, status_code=201)
def create_ai_chat(
    body: AiRequestIn,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
    settings: SettingsDep,
) -> AiChatOut:
    cls = get_class_or_404(db, body.class_id)
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    today = school_today(db, cls.school_id)
    r = resolve(db, user, bindings, cls, body, cfg, today, request=request)
    chat = create_chat(db, user, cls, r)
    return chat_out(db, chat, clock.utc_now())


@router.get("/chats", response_model=AiChatList)
def list_ai_chats(
    class_id: UUID,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
) -> AiChatList:
    cls = get_class_or_404(db, class_id)
    ensure(db, request, user.id, bindings, Perm.AI_USE, class_scope_of(cls), object_id=str(cls.id))
    return AiChatList(items=list_chats(db, user.id, cls.id))


@router.get("/chats/{chat_id}", response_model=AiChatOut)
def get_ai_chat(chat_id: UUID, db: DbDep, user: UserDep) -> AiChatOut:
    chat = get_own_chat(db, user.id, chat_id)
    return chat_out(db, chat, clock.utc_now())


@router.delete("/chats/{chat_id}", status_code=204)
def delete_ai_chat(chat_id: UUID, db: DbDep, user: UserDep) -> Response:
    delete_chat(db, user.id, chat_id)
    return Response(status_code=204)


def _chat_needs(chat) -> frozenset[Perm]:
    template = TEMPLATES.get(chat.template_id) if chat.template_id else None
    return template.needs if template else frozenset({Perm.AI_USE})


_NOTE_N = re.compile(r"(\d+)")


@router.get("/chats/{chat_id}/prompt", response_model=AiPrompt)
def ai_chat_prompt(
    chat_id: UUID,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
) -> AiPrompt:
    chat = get_own_chat(db, user.id, chat_id)
    cls = get_class_or_404(db, chat.class_id)
    _check_perms(db, request, user, bindings, cls, _chat_needs(chat))
    masker = masker_for_class(db, cls.id)
    system = scrub(system_prompt(db, user, bindings, cls))
    template = TEMPLATES.get(chat.template_id) if chat.template_id else None
    items = chat_items(db, chat.id)
    jobs: list[Job] = []
    if chat.batch_only and template is not None:
        today = school_today(db, cls.school_id)
        for item in items:
            student = db.get(Student, item.student_id)
            if student is None:
                continue
            found = _NOTE_N.search(item.note or "")
            try:
                jobs.append(
                    build_job(
                        db,
                        user,
                        bindings,
                        cls,
                        template,
                        chat.params,
                        student,
                        today,
                        masked=chat.mask,
                        masker=masker,
                        regress_n=int(found.group(1)) if found else None,
                    )  # fmt: skip
                )
            except ApiError:
                continue  # 学生已不在本班:复制提示词时跳过
    else:
        first = next((m for m in ordered_messages(db, chat.id) if m.role == "user"), None)
        sent = first.sent if first is not None and first.sent is not None else ""
        jobs.append(
            Job(
                sent=sent, student_id=chat.student_id, enrollment_id=None, note=None, student_ids=[]
            )
        )
    r = Resolved(
        template=template, title=chat.title, show=chat.title, params=chat.params,
        student_id=chat.student_id, save_as=chat.save_as, batch_only=chat.batch_only,
        masked=chat.mask, masker=masker, system=system, jobs=jobs,
    )  # fmt: skip
    prompt = combined_prompt(r)
    mapping = masker.mapping("\n".join(j.sent for j in jobs)) if chat.mask else []
    student_ids = [chat.student_id] if chat.student_id else [i.student_id for i in items]
    record(
        db,
        user_id=user.id,
        action="ai.prompt_copy",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={
            "template": chat.template_id,
            "student_ids": [str(s) for s in student_ids],
            "masked": chat.mask,
            "chars_in": len(prompt),
            "chars_out": 0,
        },
    )
    db.commit()
    return AiPrompt(prompt=prompt, mapping=[AiMapping(code=c, name=n) for c, n in mapping])


@router.post("/chats/{chat_id}/reply")
def ai_chat_reply(
    chat_id: UUID,
    body: AiReplyIn,
    request: Request,
    db: DbDep,
    user: UserDep,
    bindings: BindingsDep,
    settings: SettingsDep,
    redis: RedisDep,
    scope: ScopeDep,
) -> StreamingResponse:
    chat = get_own_chat(db, user.id, chat_id)
    cls = get_class_or_404(db, chat.class_id)
    _check_perms(db, request, user, bindings, cls, _chat_needs(chat))
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    if cfg is None or not is_ready(cfg):
        raise ApiError(409, "AI_NOT_CONFIGURED", "学校还没有配置 AI 服务")
    if chat.batch_only:
        raise ApiError(409, "AI_BATCH_ONLY", "批量对话不能追问或重新生成")
    if body.text is None and not body.regenerate:
        msgs = ordered_messages(db, chat.id)
        if not msgs or msgs[-1].role != "user":
            raise ApiError(409, "AI_NOTHING_TO_REPLY", "没有需要回复的内容")
    token = acquire_lock(redis, chat.id)
    try:
        ctx = GenContext(
            chat_id=chat.id,
            user_id=user.id,
            school_id=user.school_id,
            class_id=cls.id,
            cfg=cfg,
            transport=request.app.state.ai_transport,
            scope=scope,
            redis=redis,
            lock_key=lock_key(chat.id),
            lock_token=token,
            ip=request.client.host if request.client and _is_ip(request.client.host) else None,
            user_agent=request.headers.get("user-agent"),
        )
        return StreamingResponse(
            reply_events(ctx, body),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except BaseException:
        release_lock(redis, lock_key(chat.id), token)
        raise


def _is_ip(host: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True
