import base64
import binascii
from functools import lru_cache
from pathlib import Path
from uuid import UUID

from fastapi import Request
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
DEV_SECRET = "dev-secret-change-me"
DEV_MASTER_KEY = base64.b64encode(b"dev-master-key-change-me-32bytes").decode()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="WS_",
        env_file=SERVER_DIR / ".env",
        extra="ignore",
    )

    env: str = "dev"
    database_url: str = "postgresql+psycopg://workstation:workstation@localhost:5432/workstation"
    redis_url: str = "redis://localhost:6379/0"
    school_id: UUID = UUID("11111111-1111-1111-1111-111111111111")
    jwt_secret: str = DEV_SECRET
    access_ttl_seconds: int = 900
    refresh_ttl_seconds: int = 604800
    login_max_failures: int = 5
    login_lock_seconds: int = 900
    log_level: str = "INFO"
    master_key: str = DEV_MASTER_KEY

    @model_validator(mode="after")
    def _reject_default_secret_outside_dev(self) -> "Settings":
        if self.env != "dev" and self.jwt_secret == DEV_SECRET:
            raise ValueError("WS_JWT_SECRET must be set when WS_ENV is not 'dev'")
        if self.env != "dev" and self.master_key == DEV_MASTER_KEY:
            raise ValueError("WS_MASTER_KEY must be set when WS_ENV is not 'dev'")
        return self

    @model_validator(mode="after")
    def _master_key_is_32_bytes(self) -> "Settings":
        try:
            ok = len(base64.b64decode(self.master_key, validate=True)) == 32
        except (binascii.Error, ValueError):
            ok = False
        if not ok:
            raise ValueError("WS_MASTER_KEY 必须是 32 字节的 base64")
        return self

    @property
    def master_key_bytes(self) -> bytes:
        return base64.b64decode(self.master_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings_dep(request: Request) -> Settings:
    return request.app.state.settings
