import socket

import pytest

from app.domain.cameras import lan
from app.errors import ApiError


@pytest.mark.parametrize(
    "ip",
    [
        "8.8.8.8",
        "192.0.2.10",
        "198.51.100.7",
        "203.0.113.5",
        "0.0.0.1",
        "::ffff:8.8.8.8",
        "127.0.0.1",
        "::1",
        "172.32.0.1",
        "not-an-ip",
        "",
        None,
    ],
)
def test_not_lan(ip):
    assert lan.is_lan_ip(ip) is False


@pytest.mark.parametrize(
    "ip",
    [
        "10.1.2.3",
        "192.168.0.9",
        "172.16.5.5",
        "fd00::1",
        "::ffff:10.0.0.5",
        "169.254.1.1",
        "fe80::1",
    ],
)
def test_lan(ip):
    assert lan.is_lan_ip(ip) is True


def test_loopback_only_when_allowed():
    for ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
        assert lan.is_lan_ip(ip) is False
        assert lan.is_lan_ip(ip, allow_loopback=True) is True
    assert lan.is_lan_ip("8.8.8.8", allow_loopback=True) is False


def _fake_dns(monkeypatch, addrs):
    def fake(host, port, *a, **kw):
        if addrs is None:
            raise socket.gaierror("nope")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a_, 0)) for a_ in addrs]

    monkeypatch.setattr(socket, "getaddrinfo", fake)


def test_resolve_all_must_be_lan(monkeypatch):
    _fake_dns(monkeypatch, ["10.0.0.2", "192.168.0.3"])
    assert lan.resolve_is_lan("cam.example.test") is True
    _fake_dns(monkeypatch, ["10.0.0.2", "8.8.8.8"])
    assert lan.resolve_is_lan("cam.example.test") is False


def test_resolve_failure_or_empty_is_false(monkeypatch):
    _fake_dns(monkeypatch, None)
    assert lan.resolve_is_lan("cam.example.test") is False
    _fake_dns(monkeypatch, [])
    assert lan.resolve_is_lan("cam.example.test") is False


def test_resolve_loopback_flag(monkeypatch):
    _fake_dns(monkeypatch, ["127.0.0.1"])
    assert lan.resolve_is_lan("localhost") is False
    assert lan.resolve_is_lan("localhost", allow_loopback=True) is True


def _code(url, **kw):
    with pytest.raises(ApiError) as e:
        lan.validate_rtsp_url(url, **kw)
    assert e.value.status == 400
    return e.value.code


def test_rtsp_url_with_userinfo_rejected():
    assert _code("rtsp://camuser:campass-test@10.0.0.2/x") == "RTSP_URL_HAS_CREDENTIALS"
    assert _code("rtsp://camuser@10.0.0.2/x") == "RTSP_URL_HAS_CREDENTIALS"


def test_rtsp_url_bad_scheme_or_host():
    assert _code("http://10.0.0.2/x") == "RTSP_URL_INVALID"
    assert _code("rtsps://10.0.0.2/x") == "RTSP_URL_INVALID"
    assert _code("rtsp:///x") == "RTSP_URL_INVALID"
    assert _code("rtsp://") == "RTSP_URL_INVALID"
    assert _code("rtsp://10.0.0.2:abc/x") == "RTSP_URL_INVALID"


def test_rtsp_url_public_rejected(monkeypatch):
    _fake_dns(monkeypatch, ["203.0.113.5"])
    assert _code("rtsp://cam.example.test/x") == "RTSP_URL_NOT_LAN"
    assert _code("rtsp://8.8.8.8/x") == "RTSP_URL_NOT_LAN"


def test_rtsp_url_valid_normalized(monkeypatch):
    _fake_dns(monkeypatch, ["10.0.0.2"])
    assert lan.validate_rtsp_url("  RTSP://10.0.0.2:8554/live/1?x=1 ") == (
        "rtsp://10.0.0.2:8554/live/1?x=1"
    )
    assert lan.validate_rtsp_url("rtsp://[fd00::1]/a") == "rtsp://[fd00::1]/a"


def test_rtsp_url_loopback_dev_only(monkeypatch):
    assert _code("rtsp://127.0.0.1:8554/cam1") == "RTSP_URL_NOT_LAN"
    assert (
        lan.validate_rtsp_url("rtsp://127.0.0.1:8554/cam1", allow_loopback=True)
        == "rtsp://127.0.0.1:8554/cam1"
    )


def test_mask_url():
    assert lan.mask_url("rtsp://camuser:campass-test@10.0.0.2/x?password=abc&a=1") == (
        "rtsp://***@10.0.0.2/x?password=***&a=1"
    )
    out = lan.mask_url("rtsp://10.0.0.2/x?token=t1&Passwd=p2&pwd=p3&k=v")
    assert "t1" not in out and "p2" not in out and "p3" not in out
    assert "k=v" in out
    assert "campass-test" not in lan.mask_url("rtsp://camuser:campass-test@10.0.0.2:554/")
