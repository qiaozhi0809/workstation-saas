import ipaddress
import re
import socket
from collections.abc import Iterable
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit

from app.errors import ApiError

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


class HasTrustedNetworks(Protocol):
    """app.config.Settings 的子集:只要 trusted_networks(避免这里依赖整份配置)。"""

    @property
    def trusted_networks(self) -> list[IPNetwork]: ...


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
# 口令类查询参数只在这里列一份(L295):worker 的日志打码(stream/ffmpeg.py)也走这条正则;
# sig 是云厂商 / NVR 常见的签名参数
_SECRET_QUERY = re.compile(
    r"(?i)(?<![A-Za-z0-9])((?:api_key|key|secret|auth|token|password|passwd|pwd|sig)=)[^&#\s]*"
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


def _in_networks(ip: str | None, networks: Iterable[IPNetwork]) -> bool:
    addr = _parse(ip)
    if addr is None:
        return False
    return any(addr in net for net in networks if net.version == addr.version)


def is_denied_ip(ip: str | None, settings: HasTrustedNetworks) -> bool:
    """落在可信代理 / compose 子网(WS_TRUSTED_PROXIES)里的地址:那是本系统自己的容器网络,
    摄像头不可能在那里;放行等于让有 camera.manage 的人借"测试连接"探测内部服务端口(L159)。"""
    return _in_networks(ip, settings.trusted_networks)


def _resolve(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None)
    except (OSError, UnicodeError):
        return []
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def resolve_lan_ips(
    host: str, *, allow_loopback: bool = False, denied: Iterable[IPNetwork] = ()
) -> list[str]:
    """主机名解析出的全部地址都在内网、且都不在拒绝网段时返回它们(去重、保持解析顺序),否则 []。

    失败即关。worker 拿第一个写进 ffmpeg 的拉流地址(L155):判定用的和连接用的是同一个 IP,
    摄像头名字在两次解析之间被改指向别处(DNS 重绑定)也没用。denied 与保存时的 is_denied_ip
    同口径。"""
    ips = _resolve(host)
    if not ips or not all(is_lan_ip(ip, allow_loopback=allow_loopback) for ip in ips):
        return []
    denied = tuple(denied)
    if any(_in_networks(ip, denied) for ip in ips):
        return []
    return ips


def resolve_is_lan(
    host: str, *, allow_loopback: bool = False, denied: Iterable[IPNetwork] = ()
) -> bool:
    return bool(resolve_lan_ips(host, allow_loopback=allow_loopback, denied=denied))


def validate_rtsp_url(
    url: str, *, settings: HasTrustedNetworks, allow_loopback: bool = False
) -> str:
    """settings 必填:省掉就等于关掉可信网段拒绝,这种默认不能有。"""
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
    ips = resolve_lan_ips(host, allow_loopback=allow_loopback)
    if not ips:
        raise ApiError(400, "RTSP_URL_NOT_LAN", "摄像头地址必须在学校内网")
    if any(is_denied_ip(ip, settings) for ip in ips):
        raise ApiError(
            400, "RTSP_URL_NOT_LAN", "摄像头地址落在本系统自己的容器 / 可信代理网段,不能登记"
        )
    # 用解析结果重建,存下的就是校验过的
    return urlunsplit(("rtsp", parts.netloc, parts.path, parts.query, parts.fragment))


def mask_url(text: str) -> str:
    """打码 URL(也适用于夹着 URL 的错误文本):userinfo 和查询串里的口令类参数换成 ***。"""
    text = _USERINFO.sub(r"\1***@", text)
    return _SECRET_QUERY.sub(r"\1***", text)
