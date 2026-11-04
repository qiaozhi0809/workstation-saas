import asyncio
import re
from datetime import date
from uuid import UUID

import httpx
import structlog
from fastapi import Request
from sqlalchemy import Integer, case, cast, func, select
from sqlalchemy.orm import Session

from app import clock
from app.ai.client import AIUpstreamError, ChatMessage, Delta
from app.ai.providers import PRESETS
from app.ai.settings import (
    AIConfig,
    clear_ai_config,
    key_undecryptable,
    load_ai_config,
    make_client,
    save_ai_config,
)
from app.ai.templates import TEMPLATES
from app.audit.service import record
from app.domain.ai_admin.schemas import (
    AiConfigSave,
    AiConfigView,
    AiProviderOption,
    AiTemplateCount,
    AiTestResult,
    AiUsage,
    AiUsageRow,
    AiUsageTotal,
)
from app.domain.reports.attendance import MONTH_PATTERN
from app.domain.schools.service import local_day_start_utc, school_tz
from app.errors import ApiError
from app.models import User
from app.models.audit import AuditLog

log = structlog.get_logger()

TOP_TEMPLATES = 3
MIN_YEAR, MAX_YEAR = 1970, 2100
TEST_TIMEOUT = 10.0
DELETED_USER = "(已删除账号)"


def resolve_month(db: Session, school_id: UUID, month: str | None) -> str:
    """缺省为学校时区的本月;格式必须是 YYYY-MM。"""
    if month is None:
        today = clock.utc_now().astimezone(school_tz(db, school_id)).date()
        return f"{today.year:04d}-{today.month:02d}"
    if not re.fullmatch(MONTH_PATTERN, month) or not MIN_YEAR <= int(month[:4]) <= MAX_YEAR:
        raise ApiError(400, "BAD_REQUEST", "月份格式应为 YYYY-MM")
    return month


def _label(template_id: str) -> str:
    t = TEMPLATES.get(template_id)
    return t.title if t is not None else template_id


def _token(text_value):
    """token 数只认 9 位以内的非负整数文本;null、浮点、乱码一律不计(不让一行脏审计拖垮整页)。"""
    return case((text_value.regexp_match(r"^[0-9]{1,9}$"), cast(text_value, Integer)), else_=None)


def usage(db: Session, school_id: UUID, month: str) -> AiUsage:
    tz = school_tz(db, school_id)
    year, mon = int(month[:4]), int(month[5:])
    start = local_day_start_utc(date(year, mon, 1), tz)
    end = local_day_start_utc(date(year + (mon == 12), mon % 12 + 1, 1), tz)
    template = AuditLog.extra["template"].as_string()
    prompt = _token(AuditLog.extra["prompt_tokens"].as_string())
    completion = _token(AuditLog.extra["completion_tokens"].as_string())
    stmt = (
        select(
            AuditLog.user_id,
            template.label("template"),
            func.count().label("calls"),
            func.count().filter(AuditLog.success.is_(False)).label("failed"),
            func.coalesce(func.sum(prompt), 0).label("prompt"),
            func.coalesce(func.sum(completion), 0).label("completion"),
        )
        .where(
            AuditLog.action == "ai.generate",
            AuditLog.user_id.is_not(None),
            AuditLog.at >= start,
            AuditLog.at < end,
        )
        .group_by(AuditLog.user_id, template)
    )
    per_user: dict[UUID, dict] = {}
    for uid, tpl, calls, failed, p, c in db.execute(stmt):
        acc = per_user.setdefault(
            uid, {"calls": 0, "failed": 0, "prompt": 0, "completion": 0, "templates": {}}
        )
        acc["calls"] += calls
        acc["failed"] += failed
        acc["prompt"] += int(p)
        acc["completion"] += int(c)
        if tpl:
            acc["templates"][tpl] = acc["templates"].get(tpl, 0) + calls
    names = (
        dict(db.execute(select(User.id, User.display_name).where(User.id.in_(per_user))).all())
        if per_user
        else {}
    )
    rows = [
        AiUsageRow(
            user_id=str(uid),
            display_name=names.get(uid, DELETED_USER),
            calls=a["calls"],
            failed=a["failed"],
            prompt_tokens=a["prompt"],
            completion_tokens=a["completion"],
            top_templates=[
                AiTemplateCount(template=t, label=_label(t), count=n)
                for t, n in sorted(a["templates"].items(), key=lambda kv: (-kv[1], kv[0]))[
                    :TOP_TEMPLATES
                ]
            ],
        )
        for uid, a in per_user.items()
    ]
    rows.sort(key=lambda r: (-r.calls, r.display_name, r.user_id))
    total = AiUsageTotal(
        calls=sum(r.calls for r in rows),
        failed=sum(r.failed for r in rows),
        prompt_tokens=sum(r.prompt_tokens for r in rows),
        completion_tokens=sum(r.completion_tokens for r in rows),
    )
    return AiUsage(month=month, rows=rows, total=total)


def _providers() -> list[AiProviderOption]:
    return [
        AiProviderOption(
            id=p.id, label=p.name, base_url=p.base_url, models=[p.model] if p.model else []
        )
        for p in PRESETS.values()
    ]


def config_view(db: Session, school_id: UUID, key: bytes) -> AiConfigView:
    cfg = load_ai_config(db, school_id, key)
    return AiConfigView(
        provider=cfg.provider if cfg else None,
        base_url=cfg.base_url if cfg else None,
        model=cfg.model if cfg else None,
        temperature=cfg.temperature if cfg else None,
        mask_forced=cfg.mask_forced if cfg else False,
        key_set=bool(cfg and cfg.api_key),
        key_undecryptable=key_undecryptable(db, school_id, key),
        providers=_providers(),
    )


def _effective(db: Session, school_id: UUID, key: bytes, body: AiConfigSave) -> AIConfig:
    """api_key 为 null 时沿用库里已存的 Key;没有则 400。"""
    api_key = body.api_key
    if api_key is None:
        old = load_ai_config(db, school_id, key)
        api_key = old.api_key if old else None
    return AIConfig(
        provider=body.provider,
        base_url=body.base_url,
        model=body.model,
        temperature=body.temperature,
        api_key=api_key,
        mask_forced=body.mask_forced,
    )


def save_config(
    db: Session, school_id: UUID, key: bytes, actor: UUID, body: AiConfigSave, request: Request
) -> AiConfigView:
    old = load_ai_config(db, school_id, key)
    cfg = _effective(db, school_id, key, body)
    if cfg.api_key is None:
        raise ApiError(400, "AI_KEY_REQUIRED", "请填写 API Key")
    save_ai_config(db, school_id, key, cfg)
    record(
        db,
        user_id=actor,
        action="ai.config",
        success=True,
        object_type="school",
        object_id=str(school_id),
        request=request,
        extra={
            "provider": cfg.provider,
            "model": cfg.model,
            "key_changed": cfg.api_key != (old.api_key if old else None),
            "via": "admin",
        },
    )
    db.commit()
    return config_view(db, school_id, key)


def delete_config(db: Session, school_id: UUID, actor: UUID, request: Request) -> None:
    clear_ai_config(db, school_id)
    record(
        db,
        user_id=actor,
        action="ai.config",
        success=True,
        object_type="school",
        object_id=str(school_id),
        request=request,
        extra={"cleared": True},
    )
    db.commit()


async def _probe(cfg: AIConfig, transport: httpx.AsyncBaseTransport | None) -> None:
    messages = [
        ChatMessage("system", "只做连通性测试"),
        ChatMessage("user", "请只回复四个字:连接成功"),
    ]
    got = False
    async for ev in make_client(cfg, transport).stream(messages, max_tokens=20):
        got = got or isinstance(ev, Delta)
    if not got:
        raise AIUpstreamError("AI_UPSTREAM", "AI 服务暂时出错了,请稍后再试")


async def _probe_limited(cfg: AIConfig, transport: httpx.AsyncBaseTransport | None) -> None:
    await asyncio.wait_for(_probe(cfg, transport), TEST_TIMEOUT)


def test_config(
    db: Session,
    school_id: UUID,
    key: bytes,
    body: AiConfigSave,
    transport: httpx.AsyncBaseTransport | None,
) -> AiTestResult:
    cfg = _effective(db, school_id, key, body)
    if cfg.api_key is None:
        return AiTestResult(ok=False, message="请填写 API Key")
    try:
        asyncio.run(_probe_limited(cfg, transport))
    except AIUpstreamError as e:
        return AiTestResult(ok=False, message=e.message)
    except TimeoutError:
        return AiTestResult(ok=False, message="连接超时,请检查服务地址或稍后再试")
    except Exception as e:  # 例如 Key 含非 ASCII 字符导致请求头编码失败;不记录、不回显 Key
        log.warning("ai_test_failed", error_type=type(e).__name__)
        return AiTestResult(ok=False, message="连不上 AI 服务,请检查服务地址和 API Key")
    return AiTestResult(ok=True, message="连接成功")
