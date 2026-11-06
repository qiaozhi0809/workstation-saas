"""worker 拉流前的内网判定(失败即关)。与后端 domain/cameras/lan.py 各自独立实现,互为纵深防御。"""

import ipaddress
import socket
from urllib.parse import urlsplit


def is_lan_ip(ip: str, *, allow_loopback: bool = False) -> bool:
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped  # ::ffff:8.8.8.8 按映射后的 v4 判
    if addr.is_loopback:  # 先排除回环:ipaddress 认为回环也是 is_private
        return allow_loopback
    return addr.is_private or addr.is_link_local


def resolve_is_lan(host: str, *, allow_loopback: bool = False) -> bool:
    """host 的全部解析结果都是内网才算;解析失败、没有结果都按"不是"。"""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return False
    ips = [str(info[4][0]) for info in infos]
    return bool(ips) and all(is_lan_ip(ip, allow_loopback=allow_loopback) for ip in ips)


def url_host(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None
