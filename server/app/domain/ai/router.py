from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.ai.providers import provider_label
from app.ai.requests import combined_prompt, effective_default, field_defaults, resolve
from app.ai.settings import is_ready, load_ai_config
from app.ai.templates import CATEGORIES, PERM_ORDER, TEMPLATES
from app.audit.service import record
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.ai.schemas import (
    AiCategory,
    AiField,
    AiMapping,
    AiPrompt,
    AiRequestIn,
    AiStatus,
    AiTemplate,
    AiTemplates,
)
from app.domain.classes.service import class_scope_of, get_class_or_404
from app.domain.schools.service import school_today
from app.models import User
from app.rbac.bindings import Binding, can
from app.rbac.deps import get_bindings
from app.rbac.guard import ensure
from app.rbac.roles import Perm

router = APIRouter(prefix="/ai", tags=["ai"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
BindingsDep = Annotated[list[Binding], Depends(get_bindings)]


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
