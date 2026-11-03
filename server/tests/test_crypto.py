import pytest

from app.crypto import CryptoError, decrypt, encrypt

KEY = b"x" * 32


def test_round_trip():
    assert decrypt(encrypt("sk-test-0000", KEY), KEY) == "sk-test-0000"


def test_nonce_differs():
    assert encrypt("a", KEY) != encrypt("a", KEY)


def test_wrong_key_fails():
    with pytest.raises(CryptoError):
        decrypt(encrypt("a", KEY), b"y" * 32)


def test_tampered_or_garbage_fails():
    with pytest.raises(CryptoError):
        decrypt("not-base64!!", KEY)
    with pytest.raises(CryptoError):
        decrypt("", KEY)
