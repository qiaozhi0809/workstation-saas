import base64
import ipaddress
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_defaults():
    s = Settings(_env_file=None)
    assert s.access_ttl_seconds == 900
    assert s.refresh_ttl_seconds == 604800
    assert s.login_max_failures == 5
    assert str(s.school_id) == "11111111-1111-1111-1111-111111111111"


def test_env_override(monkeypatch):
    monkeypatch.setenv("WS_ACCESS_TTL_SECONDS", "60")
    assert Settings(_env_file=None).access_ttl_seconds == 60


def test_non_dev_rejects_default_secret():
    with pytest.raises(ValueError):
        Settings(_env_file=None, env="prod")


def test_master_key_must_be_32_bytes():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, master_key=base64.b64encode(b"short").decode())


def test_default_master_key_rejected_outside_dev():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, env="prod", jwt_secret="x" * 32)


def test_default_master_key_is_32_bytes():
    assert len(Settings(_env_file=None).master_key_bytes) == 32


_OK_MASTER_KEY = base64.b64encode(b"k" * 32).decode()


def _prod(**kw):
    # prod 必须配可信代理网段(L177),这里给 compose 的默认子网,用例可覆盖
    kw = {"trusted_proxies": ["172.30.0.0/24"], **kw}
    return Settings(_env_file=None, env="prod", master_key=_OK_MASTER_KEY, **kw)


def test_short_secret_rejected_outside_dev():
    with pytest.raises(ValidationError, match="WS_JWT_SECRET"):
        _prod(jwt_secret="a" * 31)
    with pytest.raises(ValidationError, match="WS_JWT_SECRET"):
        _prod(jwt_secret="CHANGE_ME_32_BYTES_MIN")
    with pytest.raises(ValidationError, match="WS_JWT_SECRET"):
        _prod(jwt_secret="x" * 40 + "CHANGE_ME")
    assert _prod(jwt_secret="a" * 32).jwt_secret == "a" * 32
    # dev 环境照旧放行,哪怕是占位值
    assert Settings(_env_file=None, env="dev", jwt_secret="CHANGE_ME_32_BYTES_MIN")


def test_trusted_proxies_parse(monkeypatch):
    assert Settings(_env_file=None).trusted_proxies == []
    monkeypatch.setenv("WS_TRUSTED_PROXIES", "127.0.0.1, 10.0.0.0/8 ,::1")
    s = Settings(_env_file=None)
    assert s.trusted_proxies == ["127.0.0.1", "10.0.0.0/8", "::1"]
    assert [str(n) for n in s.trusted_networks] == ["127.0.0.1/32", "10.0.0.0/8", "::1/128"]
    monkeypatch.setenv("WS_TRUSTED_PROXIES", "")
    assert Settings(_env_file=None).trusted_proxies == []
    for bad in ("not-an-ip", "10.0.0.0/33", "127.0.0.1,,", "127.0.0.1;10.0.0.1"):
        monkeypatch.setenv("WS_TRUSTED_PROXIES", bad)
        with pytest.raises(ValidationError, match="WS_TRUSTED_PROXIES"):
            Settings(_env_file=None)


# ---- L167:WS_ENV 失败即关(conftest 给测试进程设了 WS_ENV=dev,测默认值要先去掉)----


def _prod_env_kw():
    return {
        "jwt_secret": "a" * 32,
        "master_key": _OK_MASTER_KEY,
        "trusted_proxies": ["172.30.0.0/24"],
    }


def test_env_defaults_to_prod(monkeypatch):
    monkeypatch.delenv("WS_ENV", raising=False)
    assert Settings(_env_file=None, **_prod_env_kw()).env == "prod"
    # 默认 prod + 默认密钥:启动失败,而不是悄悄按 dev 放行
    with pytest.raises(ValidationError, match="WS_JWT_SECRET"):
        Settings(_env_file=None)


@pytest.mark.parametrize("bad", ["staging", "production", "Dev", ""])
def test_env_only_accepts_dev_or_prod(monkeypatch, bad):
    with pytest.raises(ValidationError, match="env"):
        Settings(_env_file=None, env=bad, **_prod_env_kw())
    monkeypatch.setenv("WS_ENV", bad)
    with pytest.raises(ValidationError, match="env"):
        Settings(_env_file=None, **_prod_env_kw())


def test_env_from_environment(monkeypatch):
    monkeypatch.setenv("WS_ENV", "prod")
    assert Settings(_env_file=None, **_prod_env_kw()).env == "prod"
    monkeypatch.setenv("WS_ENV", "dev")
    assert Settings(_env_file=None).env == "dev"


# ---- L177:生产环境的可信代理网段失败即关 ----


def test_prod_requires_trusted_proxies():
    msg = "WS_TRUSTED_PROXIES 在生产环境必须设置为反向代理（web 容器）所在网段，例如 172.30.0.0/24"
    with pytest.raises(ValidationError, match=msg):
        Settings(_env_file=None, env="prod", jwt_secret="a" * 32, master_key=_OK_MASTER_KEY)
    with pytest.raises(ValidationError, match=msg):
        _prod(jwt_secret="a" * 32, trusted_proxies=[])
    assert _prod(jwt_secret="a" * 32).trusted_proxies == ["172.30.0.0/24"]
    # dev 不要求
    assert Settings(_env_file=None, env="dev").trusted_proxies == []


@pytest.mark.parametrize(
    "wide", ["0.0.0.0/0", "10.0.0.0/8", "172.0.0.0/15", "::/0", "2001:db8::/47"]
)
def test_prod_rejects_too_wide_trusted_proxies(wide):
    with pytest.raises(ValidationError, match="WS_TRUSTED_PROXIES 网段过宽") as e:
        _prod(jwt_secret="a" * 32, trusted_proxies=["172.30.0.0/24", wide])
    assert "会让校外请求被当成内网来源" in str(e.value)
    assert str(ipaddress.ip_network(wide)) in str(e.value)
    # dev 不限制
    assert Settings(_env_file=None, env="dev", trusted_proxies=[wide]).trusted_proxies == [wide]


@pytest.mark.parametrize(
    "ok", ["172.17.0.0/16", "10.1.0.0/16", "172.30.0.2", "fd00::/48", "fd00::1"]
)
def test_prod_accepts_narrow_trusted_proxies(ok):
    assert _prod(jwt_secret="a" * 32, trusted_proxies=[ok]).trusted_proxies == [ok]


@pytest.mark.parametrize("days", [29, 731])
def test_login_log_days_out_of_range_rejected(days):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, login_log_days=days)


@pytest.mark.parametrize("days", [30, 730])
def test_login_log_days_bounds_accepted(days):
    assert Settings(_env_file=None, login_log_days=days).login_log_days == days


def test_hls_root_and_stream_max(monkeypatch):
    s = Settings(_env_file=None)
    assert s.hls_root == Path("/run/ws-hls")
    assert s.stream_max == 10
    monkeypatch.setenv("WS_HLS_ROOT", "/tmp/hls-test")
    monkeypatch.setenv("WS_STREAM_MAX", "4")
    s = Settings(_env_file=None)
    assert s.hls_root == Path("/tmp/hls-test")
    assert s.stream_max == 4
