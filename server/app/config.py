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
    log_dir: Path | None = None
    log_retention_days: int = 14
    login_log_days: int = 180
    hls_root: Path = Path("/run/ws-hls")
    stream_max: int = 10
    # 逗号分隔的 IP / CIDR;直连地址在其中时才采信 X-Forwarded-For
    trusted_proxies: Annotated[list[str], NoDecode] = []
    _trusted_networks: list[IPNetwork] = PrivateAttr(default_factory=list)

    @field_validator("trusted_proxies", mode="before")
    @classmethod
    def _split_trusted_proxies(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",")] if value.strip() else []
        return value

    @field_validator("log_retention_days")
    @classmethod
    def _retention_range(cls, value: int) -> int:
        if not 7 <= value <= 30:
            raise ValueError("WS_LOG_RETENTION_DAYS 必须在 7–30 之间")
        return value

    @field_validator("login_log_days")
    @classmethod
    def _login_log_range(cls, value: int) -> int:
        if not 30 <= value <= 730:
            raise ValueError("WS_LOGIN_LOG_DAYS 必须在 30–730 之间")
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

    @model_validator(mode="after")
    def _trusted_proxies_required_outside_dev(self) -> "Settings":
        """失败即关(L177):生产必须明确反向代理所在网段,且网段不能宽到把校外地址也当成代理。

        漏配 / 配错时 `_client_ip` 会回退到直连地址(Caddy 容器 172.30.0.x,属私网),摄像头播放接口
        就会把公网请求当成内网来源;过宽的网段(如 0.0.0.0/0)则让任何直连地址都能伪造
        X-Forwarded-For。校验器按定义顺序执行,这里依赖上面 `_parse_trusted_proxies` 已解析好
        `_trusted_networks`。"""
        if self.env == "dev":
            return self
        if not self._trusted_networks:
            raise ValueError(
                "WS_TRUSTED_PROXIES 在生产环境必须设置为反向代理（web 容器）所在网段，"
                "例如 172.30.0.0/24"
            )
        for net in self._trusted_networks:
            if net.prefixlen < (16 if net.version == 4 else 48):
                raise ValueError(f"WS_TRUSTED_PROXIES 网段过宽：{net} 会让校外请求被当成内网来源")
        return self

    @property
    def master_key_bytes(self) -> bytes:
        return base64.b64decode(self.master_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings_dep(request: Request) -> Settings:
    return request.app.state.settings
