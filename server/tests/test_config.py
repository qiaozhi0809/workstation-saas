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
