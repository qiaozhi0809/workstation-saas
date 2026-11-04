import base64

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
