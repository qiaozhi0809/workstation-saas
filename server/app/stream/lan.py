"""worker 拉流前的内网判定(失败即关)。与后端 domain/cameras/lan.py 各自独立实现,互为纵深防御。"""

import ipaddress
import socket
from urllib.parse import urlsplit

# 显式网段,不用 ipaddress 的 is_private:它把文档段(192.0.2.0/24、198.51.100.0/24、203.0.113.0/24)、
# 0.0.0.0/8、198.18.0.0/15 等也算"私有",会让不该放行的地址通过
LAN_NETWORKS = tuple(
    ipaddress.ip_network(n)
    for n in (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "fc00::/7",
        "fe80::/10",
    )
)


def is_lan_ip(ip: str, *, allow_loopback: bool = False) -> bool:
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped  # ::ffff:8.8.8.8 按映射后的 v4 判
    if addr.is_loopback:
        return allow_loopback
    return any(addr.version == net.version and addr in net for net in LAN_NETWORKS)


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


def is_rtsp_url(url: str) -> bool:
    try:
        return urlsplit(url).scheme.lower() in ("rtsp", "rtsps")
    except ValueError:
        return False
