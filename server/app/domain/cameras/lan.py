import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit

from app.errors import ApiError

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

# 视频不出校:只认这几段;不用 ipaddress 的 is_private(它把文档段 / 保留段也算私有)
LAN_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)
_LOOPBACK = (ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128"))

# 贪婪:打码到同一串非空白文本里的最后一个 @,口令里有 @ / ? # 都不会停在半截(L164);
# 路径或查询串里碰巧有 @ 的地址会多打码一截,宁可多打不能漏
_USERINFO = re.compile(r"(://)\S*@")
_SECRET_QUERY = re.compile(
    r"(?i)(?<![A-Za-z0-9])((?:api_key|key|secret|auth|token|password|passwd|pwd)=)[^&#\s]*"
)


def _parse(ip: object) -> IPAddress | None:
    if not isinstance(ip, str):
        return None
    ip = ip.strip()
    if not ip or "%" in ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped
    return addr


def is_lan_ip(ip: str | None, *, allow_loopback: bool = False) -> bool:
    addr = _parse(ip)
    if addr is None:
        return False
    if allow_loopback and any(addr in net for net in _LOOPBACK):
        return True
    return any(addr in net for net in LAN_NETWORKS if net.version == addr.version)


def resolve_is_lan(host: str, *, allow_loopback: bool = False) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except (OSError, UnicodeError):
        return False
    ips = [info[4][0] for info in infos]
    if not ips:
        return False
    return all(is_lan_ip(str(ip), allow_loopback=allow_loopback) for ip in ips)


def validate_rtsp_url(url: str, *, allow_loopback: bool = False) -> str:
    raw = url.strip()
    # urlsplit 会悄悄去掉 \t\r\n,校验的主机就和存下的字符串不一致,所以直接拒绝
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        raise ApiError(400, "RTSP_URL_INVALID", "摄像头地址含有空白或控制字符")
    if not raw[:7].lower() == "rtsp://":
        raise ApiError(400, "RTSP_URL_INVALID", "地址必须以 rtsp:// 开头")
    try:
        parts = urlsplit(raw)
        host = parts.hostname
        _ = parts.port
    except ValueError:
        raise ApiError(400, "RTSP_URL_INVALID", "摄像头地址格式不正确") from None
    if "@" in parts.netloc:
        raise ApiError(400, "RTSP_URL_HAS_CREDENTIALS", "地址里不要带用户名密码,请单独填写")
    if not host:
        raise ApiError(400, "RTSP_URL_INVALID", "摄像头地址缺少主机")
    if not resolve_is_lan(host, allow_loopback=allow_loopback):
        raise ApiError(400, "RTSP_URL_NOT_LAN", "摄像头地址必须在学校内网")
    # 用解析结果重建,存下的就是校验过的
    return urlunsplit(("rtsp", parts.netloc, parts.path, parts.query, parts.fragment))


def mask_url(text: str) -> str:
    """打码 URL(也适用于夹着 URL 的错误文本):userinfo 和查询串里的口令类参数换成 ***。"""
    text = _USERINFO.sub(r"\1***@", text)
    return _SECRET_QUERY.sub(r"\1***", text)
