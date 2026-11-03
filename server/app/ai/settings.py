from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.client import OpenAICompatClient
from app.crypto import CryptoError, decrypt, encrypt
from app.models import SchoolSetting

_KEY = "ai"

log = structlog.get_logger()


@dataclass
class AIConfig:
    provider: str
    base_url: str
    model: str
    temperature: float
    api_key: str | None
    mask_forced: bool


def _row(db: Session, school_id: UUID) -> SchoolSetting | None:
    return db.scalar(
        select(SchoolSetting).where(SchoolSetting.school_id == school_id, SchoolSetting.key == _KEY)
    )


def load_ai_config(db: Session, school_id: UUID, key: bytes) -> AIConfig | None:
    row = _row(db, school_id)
    if row is None:
        return None
    v = row.value
    enc = v.get("api_key_enc")
    api_key: str | None = None
    if enc:
        try:
            api_key = decrypt(enc, key)
        except CryptoError:
            # 主密钥可能已更换:按"未设置 Key"处理,不让状态接口和 CLI 崩溃
            log.warning("ai_key_decrypt_failed", school_id=str(school_id))
    return AIConfig(
        provider=v["provider"],
        base_url=v["base_url"],
        model=v["model"],
        temperature=v["temperature"],
        api_key=api_key,
        mask_forced=bool(v.get("mask_forced", False)),
    )


def key_undecryptable(db: Session, school_id: UUID, key: bytes) -> bool:
    """库里存着 Key 密文但用当前主密钥解不开。"""
    row = _row(db, school_id)
    enc = row.value.get("api_key_enc") if row is not None else None
    if not enc:
        return False
    try:
        decrypt(enc, key)
    except CryptoError:
        return True
    return False


def save_ai_config(db: Session, school_id: UUID, key: bytes, cfg: AIConfig) -> None:
    value = {
        "provider": cfg.provider,
        "base_url": cfg.base_url,
        "model": cfg.model,
        "temperature": cfg.temperature,
        "api_key_enc": encrypt(cfg.api_key, key) if cfg.api_key else None,
        "mask_forced": cfg.mask_forced,
    }
    row = _row(db, school_id)
    if row is None:
        db.add(SchoolSetting(school_id=school_id, key=_KEY, value=value))
    else:
        row.value = value
    db.flush()


def clear_ai_config(db: Session, school_id: UUID) -> None:
    row = _row(db, school_id)
    if row is not None:
        db.delete(row)
        db.flush()


def _is_local(base_url: str) -> bool:
    return urlparse(base_url).hostname in ("localhost", "127.0.0.1")


def is_ready(cfg: AIConfig | None) -> bool:
    if cfg is None or not cfg.base_url or not cfg.model:
        return False
    return bool(cfg.api_key) or _is_local(cfg.base_url)


def make_client(cfg: AIConfig, transport: httpx.AsyncBaseTransport | None) -> OpenAICompatClient:
    return OpenAICompatClient(
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model=cfg.model,
        temperature=cfg.temperature,
        transport=transport,
    )
