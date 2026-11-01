import pytest

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
