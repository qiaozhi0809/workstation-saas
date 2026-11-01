from functools import lru_cache
from pathlib import Path
from uuid import UUID

from fastapi import Request
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
DEV_SECRET = "dev-secret-change-me"


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

    @model_validator(mode="after")
    def _reject_default_secret_outside_dev(self) -> "Settings":
        if self.env != "dev" and self.jwt_secret == DEV_SECRET:
            raise ValueError("WS_JWT_SECRET must be set when WS_ENV is not 'dev'")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings_dep(request: Request) -> Settings:
    return request.app.state.settings
