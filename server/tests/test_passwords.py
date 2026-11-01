import pytest

from app.auth.passwords import PasswordTooLong, hash_password, verify_password


@pytest.mark.parametrize("pw", ["hello", "中文密码", "🎉Emoji🚀", "Tab\there", "混合 Mix 123!"])
def test_unicode_roundtrip(pw):
    h = hash_password(pw)
    assert verify_password(pw, h)
    assert not verify_password(pw + "x", h)


def test_nfc_normalization():
    decomposed = "cafe\u0301"  # e + 组合重音
    composed = "caf\u00e9"  # é
    assert decomposed != composed
    assert verify_password(composed, hash_password(decomposed))


def test_too_long_password():
    assert len(("中" * 24).encode()) == 72
    assert verify_password("中" * 24, hash_password("中" * 24))
    with pytest.raises(PasswordTooLong):
        hash_password("中" * 25)
    assert verify_password("中" * 25, hash_password("中" * 24)) is False
