import base64
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.crypto import CryptoError, decrypt, encrypt, needs_rewrap

KEY = b"x" * 32
AAD = "ai_key:A"


def _legacy(plain: str) -> str:
    nonce = os.urandom(12)
    return base64.b64encode(nonce + AESGCM(KEY).encrypt(nonce, plain.encode(), None)).decode()


def test_round_trip():
    assert decrypt(encrypt("sk-test-0000", KEY, aad=AAD), KEY, aad=AAD) == "sk-test-0000"


def test_v2_roundtrip():
    token = encrypt("sk-test-0000", KEY, aad=AAD)
    assert token.startswith("v2:")
    assert "sk-test-0000" not in token
    assert decrypt(token, KEY, aad=AAD) == "sk-test-0000"


def test_nonce_differs():
    assert encrypt("a", KEY, aad=AAD) != encrypt("a", KEY, aad=AAD)


def test_wrong_key_fails():
    with pytest.raises(CryptoError):
        decrypt(encrypt("a", KEY, aad=AAD), b"y" * 32, aad=AAD)


def test_aad_mismatch_fails():
    token = encrypt("a", KEY, aad="ai_key:A")
    with pytest.raises(CryptoError):
        decrypt(token, KEY, aad="ai_key:B")


def test_legacy_token_still_decrypts():
    token = _legacy("sk-test-0000")
    assert decrypt(token, KEY, aad="ai_key:A") == "sk-test-0000"


def test_needs_rewrap():
    assert needs_rewrap(_legacy("a")) is True
    assert needs_rewrap(encrypt("a", KEY, aad=AAD)) is False


def test_tampered_or_garbage_fails():
    for bad in ("not-base64!!", "", "v2:", "v2:not-base64!!"):
        with pytest.raises(CryptoError):
            decrypt(bad, KEY, aad=AAD)
