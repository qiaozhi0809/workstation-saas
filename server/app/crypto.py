import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_LEN = 12


class CryptoError(Exception):
    """解密失败:密钥不对、密文被篡改或格式不对。"""


_V2 = "v2:"


def encrypt(plain: str, key: bytes, *, aad: str) -> str:
    """AES-GCM 加密;aad 把密文绑定到用途(如 `ai_key:<school_id>`),挪到别处解不开。"""
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(key).encrypt(nonce, plain.encode(), aad.encode())
    return _V2 + base64.b64encode(nonce + ct).decode()


def needs_rewrap(token: str) -> bool:
    """旧格式(无 v2 前缀、无附加数据)的密文,应在下一次保存时重写。"""
    return not token.startswith(_V2)


def decrypt(token: str, key: bytes, *, aad: str) -> str:
    """v2 按 aad 解;无前缀按旧格式(无附加数据)解,只为读旧数据。"""
    v2 = token.startswith(_V2)
    try:
        raw = base64.b64decode(token[len(_V2) :] if v2 else token, validate=True)
        if len(raw) <= _NONCE_LEN:
            raise CryptoError("ciphertext too short")
        data = aad.encode() if v2 else None
        return AESGCM(key).decrypt(raw[:_NONCE_LEN], raw[_NONCE_LEN:], data).decode()
    except (binascii.Error, InvalidTag, UnicodeDecodeError, ValueError) as e:
        raise CryptoError("decrypt failed") from e
