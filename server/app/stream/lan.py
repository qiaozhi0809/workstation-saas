"""worker 拉流前的内网判定(失败即关)。网段表与判定只有一份:后端的 domain/cameras/lan.py(R16)。"""

from urllib.parse import urlsplit

from app.domain.cameras.lan import IPNetwork, is_lan_ip, mask_url, resolve_is_lan, resolve_lan_ips

__all__ = [
    "IPNetwork",
    "is_lan_ip",
    "is_rtsp_url",
    "mask_url",
    "resolve_is_lan",
    "resolve_lan_ips",
    "url_host",
]


def url_host(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


def is_rtsp_url(url: str) -> bool:
    try:
        return urlsplit(url).scheme.lower() in ("rtsp", "rtsps")
    except ValueError:
        return False
