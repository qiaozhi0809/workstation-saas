import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_LEN = 12


class CryptoError(Exception):
    """解密失败:密钥不对、密文被篡改或格式不对。"""


def encrypt(plain: str, key: bytes) -> str:
    nonce = os.urandom(_NONCE_LEN)
    return base64.b64encode(nonce + AESGCM(key).encrypt(nonce, plain.encode(), None)).decode()


def decrypt(token: str, key: bytes) -> str:
    try:
        raw = base64.b64decode(token, validate=True)
        if len(raw) <= _NONCE_LEN:
            raise CryptoError("ciphertext too short")
        return AESGCM(key).decrypt(raw[:_NONCE_LEN], raw[_NONCE_LEN:], None).decode()
    except (binascii.Error, InvalidTag, UnicodeDecodeError, ValueError) as e:
        raise CryptoError("decrypt failed") from e
