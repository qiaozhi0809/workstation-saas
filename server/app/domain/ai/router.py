from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.ai.providers import provider_label
from app.ai.settings import is_ready, load_ai_config
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.ai.schemas import AiStatus
from app.models import User

router = APIRouter(prefix="/ai", tags=["ai"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]


@router.get("/status", response_model=AiStatus)
def ai_status(db: DbDep, _user: UserDep, settings: SettingsDep) -> AiStatus:
    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    configured = is_ready(cfg)
    return AiStatus(
        configured=configured,
        provider_label=provider_label(cfg.provider, cfg.model) if configured and cfg else None,
        mask_forced=cfg.mask_forced if cfg else False,
    )
