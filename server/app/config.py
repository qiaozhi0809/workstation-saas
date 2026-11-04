import base64
import binascii
import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import Request
from pydantic import PrivateAttr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
DEV_SECRET = "dev-secret-change-me"
DEV_MASTER_KEY = base64.b64encode(b"dev-master-key-change-me-32bytes").decode()
MIN_SECRET_LENGTH = 32
SECRET_PLACEHOLDER = "CHANGE_ME"

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


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
    # 逗号分隔的 IP / CIDR;直连地址在其中时才采信 X-Forwarded-For
    trusted_proxies: Annotated[list[str], NoDecode] = []
    _trusted_networks: list[IPNetwork] = PrivateAttr(default_factory=list)

    @field_validator("trusted_proxies", mode="before")
    @classmethod
    def _split_trusted_proxies(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",")] if value.strip() else []
        return value

    @model_validator(mode="after")
    def _parse_trusted_proxies(self) -> "Settings":
        networks: list[IPNetwork] = []
        for item in self.trusted_proxies:
            try:
                networks.append(ipaddress.ip_network(item, strict=False))
            except ValueError:
                raise ValueError(f"WS_TRUSTED_PROXIES 含非法 IP/CIDR: {item!r}") from None
        self._trusted_networks = networks
        return self

    @property
    def trusted_networks(self) -> list[IPNetwork]:
        return self._trusted_networks

    @model_validator(mode="after")
    def _reject_default_secret_outside_dev(self) -> "Settings":
        if self.env != "dev" and self.jwt_secret == DEV_SECRET:
            raise ValueError("WS_JWT_SECRET must be set when WS_ENV is not 'dev'")
        if self.env != "dev" and (
            len(self.jwt_secret) < MIN_SECRET_LENGTH or SECRET_PLACEHOLDER in self.jwt_secret
        ):
            raise ValueError(
                f"WS_JWT_SECRET 至少 {MIN_SECRET_LENGTH} 个字符且不能含 {SECRET_PLACEHOLDER}"
            )
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
