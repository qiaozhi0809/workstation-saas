import base64
import ipaddress
import re
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.config import Settings
from app.db import get_db
from app.domain.cameras import playback
from app.domain.cameras.playback_router import Timing, get_timing
from app.errors import ApiError
from app.main import create_app
from app.models.audit import AuditLog
from app.redis import get_redis
from tests.conftest import TEST_JWT_SECRET
from tests.helpers import auth, freeze
from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID, SUBJECT_USER_ID, TEACHER_USER_ID
from tests.test_camera_access import (
    IN_PERIOD,
    OUT_PERIOD,
    PARENT,
    PRINCIPAL,
    _camera,
    _monitor,
    _timetable,
)

PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nseg-0.ts\n"
LAN = ("10.0.0.5", 50000)
PROXY = ("172.30.0.2", 50000)  # 可信代理(Caddy)


@pytest.fixture
def on(db):
    _monitor(db, True)


@pytest.fixture
def hls_root(tmp_path):
    return tmp_path / "hls"


@pytest.fixture
def pb_settings(pg_url, redis_url, hls_root) -> Settings:
    return Settings(
        _env_file=None,
        database_url=pg_url,
        redis_url=redis_url,
        jwt_secret=TEST_JWT_SECRET,
        hls_root=hls_root,
        trusted_proxies=["172.30.0.0/24"],
    )


@pytest.fixture
def make_client(pb_settings, db, redis_client):
    def make(peer=LAN, timing=None, settings=None) -> TestClient:
        app = create_app(settings or pb_settings)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_redis] = lambda: redis_client
        app.dependency_overrides[get_timing] = lambda: timing or Timing(timeout=0.05, interval=0.01)
        app.state.ai_transport = None
        return TestClient(app, client=peer)

    return make


@pytest.fixture
def client(make_client):
    return make_client()


def _worker_output(hls_root, camera_id, playlist=PLAYLIST):
    d = hls_root / str(camera_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.m3u8").write_text(playlist)
    (d / "seg-0.ts").write_bytes(b"\x47" + b"\x00" * 187)


@pytest.fixture
def cam(db, on, hls_root):
    c = _camera(db, "三年二班前", CLASS_ID)
    _worker_output(hls_root, c.id)
    return c


def m3u8(cid):
    return f"/api/v1/cameras/{cid}/stream.m3u8"


def get_playlist(client, pb_settings, cid, uid=TEACHER_USER_ID):
    return client.get(m3u8(cid), headers=auth(pb_settings, uid))


def seg_url(client, pb_settings, cid):
    res = get_playlist(client, pb_settings, cid)
    assert res.status_code == 200, res.text
    return f"/api/v1/cameras/{cid}/" + [ln for ln in res.text.splitlines() if "seg-" in ln][0]


# ---------- unit ----------


def test_sign_verify_unit(settings):
    cid, uid = uuid4(), uuid4()
    sig = playback.sign(settings, cid, uid, 1000)
    assert len(sig) == 22 and re.fullmatch(r"[A-Za-z0-9_-]{22}", sig)
    assert playback.sign(settings, cid, uid, 1000) == sig
    assert playback.verify(settings, cid, uid, 1000, sig, 950)
    assert playback.verify(settings, cid, uid, 1000, sig, 1000)
    assert not playback.verify(settings, cid, uid, 1000, sig, 1001)  # 过期
    assert not playback.verify(settings, cid, uid, 1000, sig, 939)  # exp 太远
    assert not playback.verify(settings, uuid4(), uid, 1000, sig, 950)
    assert not playback.verify(settings, cid, uuid4(), 1000, sig, 950)
    assert not playback.verify(settings, cid, uid, 1001, sig, 950)
    assert not playback.verify(
        settings, cid, uid, 1000, sig[:-1] + ("A" if sig[-1] != "A" else "B"), 950
    )
    assert not playback.verify(settings, cid, uid, 1000, "", 950)
    other = settings.model_copy(update={"jwt_secret": "x" * 40})
    assert playback.sign(other, cid, uid, 1000) != sig


def test_rewrite_playlist_unit():
    out = playback.rewrite_playlist(PLAYLIST, uuid4(), uuid4(), 123, "SIG")
    lines = out.splitlines()
    assert lines[:4] == PLAYLIST.splitlines()[:4]
    assert lines[4].startswith("hls/seg-0.ts?")
    q = parse_qs(urlsplit(lines[4]).query)
    assert q == {"exp": ["123"], "u": [q["u"][0]], "sig": ["SIG"]}
    assert out.endswith("\n")


def test_playlist_rewrite_drops_unknown_lines():
    text_in = (
        "#EXTM3U\n#EXTINF:2.0,\nseg-1.ts\n#EXTINF:2.0,\nhttp://203.0.113.9/x.ts\n"
        "../seg-2.ts\nseg-123456789.ts\nindex.m3u8\nseg-3.ts?x=1\n/etc/passwd\nseg-٣.ts\nseg-4.ts\n"
    )
    out = playback.rewrite_playlist(text_in, uuid4(), uuid4(), 5, "S")
    body = [ln for ln in out.splitlines() if not ln.startswith("#")]
    assert [ln.split("?")[0] for ln in body] == ["hls/seg-1.ts", "hls/seg-4.ts"]
    assert "203.0.113" not in out and "passwd" not in out
    assert out.count("#EXTINF") == 2


def _req(host, headers=()):
    scope = {"type": "http", "headers": list(headers), "client": (host, 1) if host else None}
    return Request(scope)


def test_ensure_lan_unit():
    dev = SimpleNamespace(env="dev")
    prod = SimpleNamespace(env="prod")
    playback.ensure_lan(_req("10.1.2.3"), prod)
    playback.ensure_lan(_req("127.0.0.1"), dev)
    for settings, host in (
        (prod, "127.0.0.1"),
        (prod, "8.8.8.8"),
        (prod, "::ffff:8.8.8.8"),
        (prod, "testclient"),
        (dev, "testclient"),
        (dev, None),
        (dev, "8.8.8.8"),
    ):
        with pytest.raises(ApiError) as e:
            playback.ensure_lan(_req(host), settings)
        assert (e.value.status, e.value.code) == (403, "CAMERA_LAN_ONLY"), host
    playback.ensure_lan(_req("::ffff:10.0.0.9"), prod)


def test_await_playlist_unit(tmp_path):
    p = tmp_path / "index.m3u8"
    sleeps, clock = [], [0.0]

    def sleep(s):
        sleeps.append(s)
        clock[0] += s

    assert not playback.await_playlist(p, 1.0, 0.2, sleep=sleep, monotonic=lambda: clock[0])
    assert 4 <= len(sleeps) <= 6
    p.write_text(PLAYLIST)
    assert playback.await_playlist(p, 1.0, 0.2, sleep=sleep, monotonic=lambda: clock[0])


def test_touch_want_and_audit_throttle(redis_client):
    cid = uuid4()
    playback.touch_want(redis_client, cid)
    assert redis_client.get(f"ws:cam:want:{cid}") == "1"
    assert 0 < redis_client.ttl(f"ws:cam:want:{cid}") <= 30
    uid = uuid4()
    assert playback.audit_due(redis_client, uid, cid) is True
    assert playback.audit_due(redis_client, uid, cid) is False
    assert 0 < redis_client.ttl(f"ws:cam:audit:{uid}:{cid}") <= 300


# ---------- playlist ----------


def test_playlist_signed_segments(client, pb_settings, db, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    res = get_playlist(client, pb_settings, cam.id)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert res.headers["cache-control"] == "no-store"
    lines = res.text.splitlines()
    assert lines[:4] == PLAYLIST.splitlines()[:4]
    parts = urlsplit(lines[4])
    assert parts.path == "hls/seg-0.ts"
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert q["exp"] == str(int(IN_PERIOD.timestamp()) + 60)
    assert q["u"] == TEACHER_USER_ID
    assert q["sig"] == playback.sign(pb_settings, cam.id, UUID(TEACHER_USER_ID), int(q["exp"]))
    # 签名后的地址可取片段(无 JWT)
    seg = client.get(f"/api/v1/cameras/{cam.id}/{lines[4]}")
    assert seg.status_code == 200
    assert seg.headers["content-type"] == "video/mp2t"
    assert seg.headers["cache-control"] == "no-store"
    assert seg.content[:1] == b"\x47"


def test_playlist_requires_jwt(client, cam):
    assert client.get(m3u8(cam.id)).status_code == 401


def test_revoked_user_denied_on_playlist(client, pb_settings, db, cam):
    assert get_playlist(client, pb_settings, cam.id).status_code == 200
    db.execute(text("UPDATE users SET status = 'frozen' WHERE id = :u"), {"u": TEACHER_USER_ID})
    db.flush()
    assert get_playlist(client, pb_settings, cam.id).status_code == 401


def test_other_school_camera_404(client, pb_settings, db, cam):
    sid = uuid4()
    db.execute(
        text("INSERT INTO schools (id, name, timezone) VALUES (:i, '外校', 'Asia/Shanghai')"),
        {"i": sid},
    )
    from app.models.cameras import Camera

    other = Camera(school_id=sid, name="外校", location="走廊", rtsp_url="rtsp://10.0.0.9/x")
    db.add(other)
    db.flush()
    for uid in (TEACHER_USER_ID, PRINCIPAL):
        assert get_playlist(client, pb_settings, other.id, uid).status_code == 404
    assert get_playlist(client, pb_settings, uuid4()).status_code == 404


def test_disabled_camera_404_for_everyone(client, pb_settings, db, cam):
    cam.enabled = False
    db.flush()
    for uid in (TEACHER_USER_ID, PRINCIPAL):
        res = get_playlist(client, pb_settings, cam.id, uid)
        assert (res.status_code, res.json()["error"]["code"]) == (404, "NOT_FOUND")


def test_playlist_rejects_public_ip(make_client, pb_settings, cam):
    # 直连来自可信代理,X-Forwarded-For 是公网
    c = make_client(PROXY)
    res = c.get(m3u8(cam.id), headers={**auth(pb_settings), "X-Forwarded-For": "8.8.8.8"})
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")
    # 直连公网
    res = make_client(("8.8.8.8", 1)).get(m3u8(cam.id), headers=auth(pb_settings))
    assert res.json()["error"]["code"] == "CAMERA_LAN_ONLY"
    # IPv4 映射的公网
    res = make_client(("::ffff:8.8.8.8", 1)).get(m3u8(cam.id), headers=auth(pb_settings))
    assert res.json()["error"]["code"] == "CAMERA_LAN_ONLY"
    # 来源无法确定(TestClient 默认 testclient)
    res = make_client(("testclient", 50000)).get(m3u8(cam.id), headers=auth(pb_settings))
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")
    # 代理头里是内网 → 放行
    res = c.get(m3u8(cam.id), headers={**auth(pb_settings), "X-Forwarded-For": "192.168.0.7"})
    assert res.status_code == 200


def test_dev_loopback_allowed(make_client, pb_settings, cam):
    assert pb_settings.env == "dev"
    res = make_client(("127.0.0.1", 1)).get(m3u8(cam.id), headers=auth(pb_settings))
    assert res.status_code == 200


def test_playlist_denied_after_period(make_client, pb_settings, db, on, hls_root, monkeypatch):
    _timetable(db)
    c = _camera(db, "三年二班前", CLASS_ID)
    _worker_output(hls_root, c.id)
    client = make_client()
    freeze(monkeypatch, datetime(2026, 11, 9, 0, 40, tzinfo=UTC).isoformat())  # 08:40
    assert get_playlist(client, pb_settings, c.id, SUBJECT_USER_ID).status_code == 200
    freeze(monkeypatch, datetime(2026, 11, 9, 0, 41, tzinfo=UTC).isoformat())  # 08:41
    res = get_playlist(client, pb_settings, c.id, SUBJECT_USER_ID)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")


def test_parent_token_denied(client, pb_settings, cam):
    res = get_playlist(client, pb_settings, cam.id, PARENT)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")
    assert "m3u8" not in res.text and "seg-" not in res.text


def test_assistant_and_offgrid_teacher_denied(client, pb_settings, cam, monkeypatch):
    freeze(monkeypatch, OUT_PERIOD.isoformat())
    for uid in (ASSISTANT_USER_ID, SUBJECT_USER_ID):
        assert get_playlist(client, pb_settings, cam.id, uid).status_code == 403


def test_denied_does_not_reveal_stream(make_client, pb_settings, db, on, redis_client):
    c = _camera(db, "三年二班前", CLASS_ID)  # 没有 worker 输出
    redis_client.hset(f"ws:cam:state:{c.id}", mapping={"status": "error", "last_error": "busy"})
    res = get_playlist(make_client(), pb_settings, c.id, PARENT)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")


def test_stream_busy(client, pb_settings, db, on, redis_client):
    c = _camera(db, "三年二班前", CLASS_ID)
    redis_client.hset(f"ws:cam:state:{c.id}", mapping={"status": "error", "last_error": "busy"})
    res = get_playlist(client, pb_settings, c.id)
    assert (res.status_code, res.json()["error"]["code"]) == (503, "STREAM_BUSY")
    # 其他错误不算 busy:走启动等待
    redis_client.hset(f"ws:cam:state:{c.id}", mapping={"last_error": "connection refused"})
    assert get_playlist(client, pb_settings, c.id).json()["error"]["code"] == "STREAM_STARTING"


def test_stream_starting(make_client, pb_settings, db, on, redis_client):
    c = _camera(db, "三年二班前", CLASS_ID)  # 没有 worker 输出
    sleeps, now = [], [0.0]

    def fake_sleep(s):
        sleeps.append(s)
        now[0] += s

    timing = Timing(timeout=8, interval=0.2, sleep=fake_sleep, monotonic=lambda: now[0])
    res = get_playlist(make_client(timing=timing), pb_settings, c.id)
    assert (res.status_code, res.json()["error"]["code"]) == (503, "STREAM_STARTING")
    assert sum(sleeps) >= 8
    # 仍然续了 want,让 worker 去拉流
    assert redis_client.get(f"ws:cam:want:{c.id}") == "1"
    assert not db.scalars(select(AuditLog).where(AuditLog.action == "camera.view")).all()


def test_playlist_touches_want(client, pb_settings, cam, redis_client):
    get_playlist(client, pb_settings, cam.id)
    assert 0 < redis_client.ttl(f"ws:cam:want:{cam.id}") <= 30


def test_view_audited_once_per_window(client, pb_settings, db, cam):
    for _ in range(3):
        assert get_playlist(client, pb_settings, cam.id).status_code == 200
    rows = db.scalars(
        select(AuditLog).where(AuditLog.action == "camera.view", AuditLog.success.is_(True))
    ).all()
    assert len(rows) == 1
    row = rows[0]
    assert (str(row.user_id), row.object_id, row.object_type) == (
        TEACHER_USER_ID,
        str(cam.id),
        "camera",
    )
    assert row.extra == {"camera_id": str(cam.id), "camera_name": "三年二班前"}
    # 另一个用户另算
    assert get_playlist(client, pb_settings, cam.id, PRINCIPAL).status_code == 200
    n = db.scalars(select(AuditLog).where(AuditLog.action == "camera.view")).all()
    assert len(n) == 2


def test_monitor_switch_off_404(client, pb_settings, db, cam):
    url = seg_url(client, pb_settings, cam.id)
    _monitor(db, False)
    res = get_playlist(client, pb_settings, cam.id)
    assert (res.status_code, res.json()["error"]["code"]) == (404, "NOT_FOUND")
    assert client.get(url).status_code == 404


# ---------- segments ----------


def test_segment_needs_no_jwt_but_needs_lan(make_client, pb_settings, cam):
    url = seg_url(make_client(), pb_settings, cam.id)
    assert make_client().get(url).status_code == 200  # 没有 Authorization
    for peer in (("8.8.8.8", 1), ("testclient", 1)):
        res = make_client(peer).get(url)
        assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")
    res = make_client(PROXY).get(url, headers={"X-Forwarded-For": "8.8.8.8"})
    assert res.json()["error"]["code"] == "CAMERA_LAN_ONLY"


def _swap(url, **kw):
    parts = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    q.update(kw)
    return parts.path + "?" + "&".join(f"{k}={v}" for k, v in q.items())


def test_segment_signature_tamper(client, pb_settings, db, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    other = _camera(db, "三年二班后", CLASS_ID)
    _worker_output(pb_settings.hls_root, other.id)
    url = seg_url(client, pb_settings, cam.id)
    assert client.get(url).status_code == 200
    exp = int(IN_PERIOD.timestamp()) + 60
    # 改 camera
    assert client.get(url.replace(str(cam.id), str(other.id))).status_code == 403
    # 改 u
    assert client.get(_swap(url, u=PRINCIPAL)).status_code == 403
    # 改 exp(更晚 / 更早)
    assert client.get(_swap(url, exp=exp + 1)).status_code == 403
    assert client.get(_swap(url, exp=exp - 1)).status_code == 403
    # 改 sig / 缺参数 / 垃圾参数
    assert client.get(_swap(url, sig="A" * 22)).status_code == 403
    path = urlsplit(url).path
    for qs in ("", f"?exp={exp}", f"?u={TEACHER_USER_ID}&sig=x", "?exp=abc&u=zz&sig=" + "A" * 22):
        res = client.get(path + qs)
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN"), qs


def test_segment_other_file_name_not_signed_for(client, pb_settings, cam, monkeypatch):
    # 签名只覆盖 camera/user/exp:同一摄像头的其他片段名在窗口内可取(与契约一致),但不存在的片段 404
    freeze(monkeypatch, IN_PERIOD.isoformat())
    url = seg_url(client, pb_settings, cam.id)
    assert client.get(url.replace("seg-0.ts", "seg-9.ts")).status_code == 404
    # 约定行为:同一签名可取该摄像头目录里任何已有的片段
    (pb_settings.hls_root / str(cam.id) / "seg-1.ts").write_bytes(b"\x47")
    assert client.get(url.replace("seg-0.ts", "seg-1.ts")).status_code == 200


def test_segment_expired(client, pb_settings, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    url = seg_url(client, pb_settings, cam.id)
    freeze(monkeypatch, (IN_PERIOD + timedelta(seconds=60)).isoformat())
    assert client.get(url).status_code == 200
    freeze(monkeypatch, (IN_PERIOD + timedelta(seconds=61)).isoformat())
    assert client.get(url).status_code == 403


def test_segment_exp_too_far_in_future(client, pb_settings, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    exp = int(IN_PERIOD.timestamp()) + 3600
    sig = playback.sign(pb_settings, cam.id, UUID(TEACHER_USER_ID), exp)
    url = f"/api/v1/cameras/{cam.id}/hls/seg-0.ts?exp={exp}&u={TEACHER_USER_ID}&sig={sig}"
    assert client.get(url).status_code == 403


def test_segment_path_traversal(client, pb_settings, cam, hls_root, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    good = seg_url(client, pb_settings, cam.id)
    q = urlsplit(good).query
    (hls_root / "secret.ts").write_bytes(b"s")
    (hls_root / str(cam.id) / "notes.txt").write_text("x")
    base = f"/api/v1/cameras/{cam.id}/hls/"
    for name in (
        "../x",
        "..%2fx",
        "%2e%2e%2fsecret.ts",
        "seg-1.ts/../../",
        "seg-1.ts%2f..%2f..%2f",
        "seg-0.ts%2f..%2fseg-0.ts",
        "index.m3u8",
        "notes.txt",
        "seg-0.ts%00",
        "seg-.ts",
        "seg-123456789.ts",
        "SEG-0.ts",
        "seg-0.ts%0a",
        "..%5csecret.ts",
    ):
        res = client.get(f"{base}{name}?{q}")
        assert res.status_code == 404, (name, res.status_code)
    # 符号链接指到目录外:拒绝
    link = hls_root / str(cam.id) / "seg-7.ts"
    link.symlink_to(hls_root / "secret.ts")
    assert client.get(f"{base}seg-7.ts?{q}").status_code == 404


def test_segment_path_traversal_even_when_unsigned(client, cam):
    # 名字先于签名校验:没有签名也是 404 而不是 403
    res = client.get(f"/api/v1/cameras/{cam.id}/hls/index.m3u8")
    assert res.status_code == 404


def test_segment_disabled_or_missing_camera_404(client, pb_settings, db, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    url = seg_url(client, pb_settings, cam.id)
    ghost = uuid4()  # 签名有效但摄像头不存在
    q = parse_qs(urlsplit(url).query)
    sig = playback.sign(pb_settings, ghost, UUID(TEACHER_USER_ID), int(q["exp"][0]))
    ghost_url = (
        f"/api/v1/cameras/{ghost}/hls/seg-0.ts?exp={q['exp'][0]}&u={TEACHER_USER_ID}&sig={sig}"
    )
    assert client.get(ghost_url).status_code == 404
    cam.enabled = False
    db.flush()
    assert client.get(url).status_code == 404


def test_segment_bad_sig_values_are_403_not_500(client, pb_settings, cam, monkeypatch):
    freeze(monkeypatch, IN_PERIOD.isoformat())
    exp = int(IN_PERIOD.timestamp()) + 30
    path = f"/api/v1/cameras/{cam.id}/hls/seg-0.ts"
    good = playback.sign(pb_settings, cam.id, UUID(TEACHER_USER_ID), exp)
    for sig in ("é" * 22, "é", "A" * 21, "A" * 23, good + "x", "%00" * 22, "A" * 21 + "é"):
        res = client.get(path, params={"exp": exp, "u": TEACHER_USER_ID, "sig": sig})
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN"), sig
    for u in ("not-a-uuid", "é", "1" * 40, ""):
        res = client.get(path, params={"exp": exp, "u": u, "sig": good})
        assert res.status_code == 403, u
    for e in ("9" * 5000, "-1", "١٢٣", "1e3", " 5"):
        res = client.get(path, params={"exp": e, "u": TEACHER_USER_ID, "sig": good})
        assert res.status_code == 403, e
    assert playback.verify(pb_settings, cam.id, UUID(TEACHER_USER_ID), exp, "é" * 22, 0) is False


def test_segment_unsigned_makes_no_db_access(make_client, pb_settings, db, cam, monkeypatch):
    c = make_client()
    calls = []
    monkeypatch.setattr(db, "get", lambda *a, **k: calls.append(a) or None)
    monkeypatch.setattr(db, "execute", lambda *a, **k: calls.append(a) or None)
    monkeypatch.setattr(db, "scalar", lambda *a, **k: calls.append(a) or None)
    unknown = uuid4()
    for cid in (cam.id, unknown):  # 存在与否都是 403:没有存在性探测
        assert c.get(f"/api/v1/cameras/{cid}/hls/seg-0.ts").status_code == 403
    assert calls == []


def test_unsigned_segment_unknown_camera_is_403_after_lan_only(make_client, pb_settings):
    assert make_client().get(f"/api/v1/cameras/{uuid4()}/hls/seg-0.ts").status_code == 403
    res = make_client(("8.8.8.8", 1)).get(f"/api/v1/cameras/{uuid4()}/hls/seg-0.ts")
    assert res.json()["error"]["code"] == "CAMERA_LAN_ONLY"


def test_denied_audit_throttled(client, pb_settings, db, cam):
    for _ in range(5):
        assert get_playlist(client, pb_settings, cam.id, PARENT).status_code == 403
    rows = db.scalars(
        select(AuditLog).where(AuditLog.action == "camera.view", AuditLog.success.is_(False))
    ).all()
    assert len(rows) == 1


def test_rewrite_allowlists_tags():
    src = (
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:4\n"
        "#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-INDEPENDENT-SEGMENTS\n"
        "#EXT-X-DISCONTINUITY-SEQUENCE:1\n"
        '#EXT-X-MAP:URI="http://203.0.113.1/init.mp4"\n'
        '#EXT-X-KEY:METHOD=AES-128,URI="http://203.0.113.1/k"\n'
        '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="x"\n#EXT-X-UNKNOWN:1\n#random comment\n'
        "#EXT-X-DISCONTINUITY\n#EXTINF:2.0,\nseg-0.ts\n#EXT-X-ENDLIST\n"
    )
    out = playback.rewrite_playlist(src, uuid4(), uuid4(), 5, "S")
    tags = [ln.split(":")[0] for ln in out.splitlines() if ln.startswith("#")]
    assert tags == [
        "#EXTM3U",
        "#EXT-X-VERSION",
        "#EXT-X-TARGETDURATION",
        "#EXT-X-MEDIA-SEQUENCE",
        "#EXT-X-PLAYLIST-TYPE",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        "#EXT-X-DISCONTINUITY-SEQUENCE",
        "#EXT-X-DISCONTINUITY",
        "#EXTINF",
        "#EXT-X-ENDLIST",
    ]
    assert "203.0.113" not in out


def test_playlist_non_utf8_does_not_500(client, pb_settings, cam, hls_root):
    (hls_root / str(cam.id) / "index.m3u8").write_bytes(PLAYLIST.encode() + b"\xff\xfe\n")
    res = get_playlist(client, pb_settings, cam.id)
    assert res.status_code == 200
    assert "seg-0.ts?" in res.text


def test_password_change_revokes_playlist(client, pb_settings, db, cam):
    headers = auth(pb_settings)
    assert client.get(m3u8(cam.id), headers=headers).status_code == 200
    db.execute(
        text("UPDATE users SET password_changed_at = now() + interval '1 hour' WHERE id = :u"),
        {"u": TEACHER_USER_ID},
    )
    db.flush()
    res = client.get(m3u8(cam.id), headers=headers)
    assert (res.status_code, res.json()["error"]["code"]) == (401, "TOKEN_EXPIRED")


def test_prod_rejects_loopback_on_both_endpoints(make_client, pb_settings, cam):
    prod = pb_settings.model_copy(update={"env": "prod"})
    dev_c = make_client(("127.0.0.1", 1))
    url = seg_url(dev_c, pb_settings, cam.id)
    assert dev_c.get(url).status_code == 200
    c = make_client(("127.0.0.1", 1), settings=prod)
    res = c.get(m3u8(cam.id), headers=auth(pb_settings))
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")
    res = c.get(url)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")


def test_segment_rejects_mapped_public_ip(make_client, pb_settings, cam):
    url = seg_url(make_client(), pb_settings, cam.id)
    res = make_client(("::ffff:8.8.8.8", 1)).get(url)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY")


# ---------- 可信代理 / 数据库会话 ----------


def _prod(pb_settings):
    return pb_settings.model_copy(update={"env": "prod"})


def test_prod_real_client_via_trusted_proxy_allowed(make_client, pb_settings, cam):
    c = make_client(PROXY, settings=_prod(pb_settings))
    res = c.get(m3u8(cam.id), headers={**auth(pb_settings), "X-Forwarded-For": "192.168.1.20"})
    assert res.status_code == 200
    url = f"/api/v1/cameras/{cam.id}/{res.text.splitlines()[4]}"
    assert c.get(url, headers={"X-Forwarded-For": "192.168.1.20"}).status_code == 200


@pytest.mark.parametrize(
    "xff",
    [None, "not-an-ip", "172.30.0.1", "172.30.0.1, 172.30.0.3", "8.8.8.8", "192.168.1.20, 8.8.8.8"],
)
def test_prod_proxy_peer_is_not_a_client(make_client, pb_settings, cam, xff):
    # 头缺失 / 非法 / 全是可信地址:解析出的是代理自己(Docker 代理改写源地址的情形),拒绝
    c = make_client(PROXY, settings=_prod(pb_settings))
    headers = auth(pb_settings)
    if xff is not None:
        headers["X-Forwarded-For"] = xff
    res = c.get(m3u8(cam.id), headers=headers)
    assert (res.status_code, res.json()["error"]["code"]) == (403, "CAMERA_LAN_ONLY"), xff
    seg = f"/api/v1/cameras/{cam.id}/hls/seg-0.ts"
    sh = {} if xff is None else {"X-Forwarded-For": xff}
    assert c.get(seg, headers=sh).json()["error"]["code"] == "CAMERA_LAN_ONLY"


def test_prod_direct_lan_client_outside_trusted_range_allowed(make_client, pb_settings, cam):
    # 10.0.0.5 不在可信代理段(172.30.0.0/24):直连的内网客户端照常放行
    c = make_client(LAN, settings=_prod(pb_settings))
    assert c.get(m3u8(cam.id), headers=auth(pb_settings)).status_code == 200


def test_dev_keeps_proxy_peer_behaviour(make_client, pb_settings, cam):
    c = make_client(PROXY)  # dev:代理自己的内网地址不拒
    assert c.get(m3u8(cam.id), headers=auth(pb_settings)).status_code == 200


def test_db_released_before_waiting(make_client, pb_settings, db, on, monkeypatch):
    c0 = _camera(db, "三年二班前", CLASS_ID)  # 没有 worker 输出:会进入等待
    events = []
    in_tx = []
    real_commit = db.commit
    monkeypatch.setattr(db, "commit", lambda: (events.append("commit"), real_commit())[1])
    now = [0.0]

    def fake_sleep(s):
        events.append("sleep")
        in_tx.append(db.in_transaction())
        now[0] += s

    timing = Timing(timeout=1, interval=0.2, sleep=fake_sleep, monotonic=lambda: now[0])
    res = get_playlist(make_client(timing=timing), pb_settings, c0.id)
    assert res.json()["error"]["code"] == "STREAM_STARTING"
    assert "sleep" in events
    assert events.index("commit") < events.index("sleep")
    assert in_tx and not any(in_tx), in_tx  # 等待期间没有事务(连接已归还)


# ---------- L177:可信网段漏配 / 配错时失败即关 ----------

PROXY3 = ("172.30.0.3", 50000)  # Caddy 容器的另一个地址(compose 子网 172.30.0.0/24)
PROD_MASTER_KEY = base64.b64encode(b"k" * 32).decode()
XFF_PUBLIC = {"X-Forwarded-For": "203.0.113.9"}


def _prod_settings(pb_settings, proxies):
    """真正按 prod 规则构造(不用 model_copy:可信网段要重新解析,prod 的启动校验也要真的跑)。"""
    return Settings(
        _env_file=None,
        env="prod",
        database_url=pb_settings.database_url,
        redis_url=pb_settings.redis_url,
        jwt_secret=TEST_JWT_SECRET,
        master_key=PROD_MASTER_KEY,
        hls_root=pb_settings.hls_root,
        trusted_proxies=proxies,
    )


def _assert_lan_only(res):
    assert res.status_code == 403, (res.status_code, res.text[:60])
    assert res.json()["error"]["code"] == "CAMERA_LAN_ONLY"


def test_prod_misconfigured_trusted_proxies_fail_closed(make_client, pb_settings, cam):
    # 可信网段配成 172.17.0.0/16(与 compose 的 172.30.0.0/24 不符):直连地址 172.30.0.3 不可信,
    # 却带着 X-Forwarded-For —— 前面有一个未被采信的代理,真实来源不明 → 403。
    # 修复前这里会把 Caddy 的容器地址(属 172.16/12 私网)当成内网客户端,对公网请求放行。
    c = make_client(PROXY3, settings=_prod_settings(pb_settings, ["172.17.0.0/16"]))
    _assert_lan_only(c.get(m3u8(cam.id), headers={**auth(pb_settings), **XFF_PUBLIC}))
    _assert_lan_only(c.get(f"/api/v1/cameras/{cam.id}/hls/seg-0.ts", headers=XFF_PUBLIC))


def test_prod_trusted_proxies_matrix(make_client, pb_settings, cam):
    s = _prod_settings(pb_settings, ["172.30.0.0/24"])
    via_proxy = make_client(PROXY3, settings=s)
    # 内网客户端经可信代理 → 200(现有正向路径仍通)
    lan_headers = {**auth(pb_settings), "X-Forwarded-For": "192.168.1.20"}
    assert via_proxy.get(m3u8(cam.id), headers=lan_headers).status_code == 200
    # 公网客户端经可信代理 → 403
    _assert_lan_only(via_proxy.get(m3u8(cam.id), headers={**auth(pb_settings), **XFF_PUBLIC}))
    # 没有代理、内网直连后端(无 X-Forwarded-For)→ 200
    direct = make_client(("192.168.1.20", 50000), settings=s)
    assert direct.get(m3u8(cam.id), headers=auth(pb_settings)).status_code == 200
    # 内网直连却带 X-Forwarded-For(直连地址不在可信网段):来源不明 → 403
    forged = {**auth(pb_settings), "X-Forwarded-For": "192.168.1.21"}
    _assert_lan_only(direct.get(m3u8(cam.id), headers=forged))


def test_is_lan_client_xff_from_untrusted_peer_unit():
    xff = [(b"x-forwarded-for", b"192.168.1.20")]
    prod = SimpleNamespace(env="prod", trusted_networks=[ipaddress.ip_network("172.30.0.0/24")])
    assert playback.is_lan_client(_req("10.1.2.3"), prod) is True
    assert playback.is_lan_client(_req("10.1.2.3", xff), prod) is False  # 不可信直连却带头
    assert playback.is_lan_client(_req("10.1.2.3", [(b"x-forwarded-for", b"")]), prod) is False
    assert playback.is_lan_client(_req("10.1.2.3", xff), SimpleNamespace(env="dev")) is True


def test_peer_ip_unit():
    from app.audit.service import peer_ip

    assert peer_ip(None) is None
    assert peer_ip(_req(None)) is None
    assert peer_ip(_req("testclient")) is None
    assert peer_ip(_req("fe80::1%eth0")) is None
    assert peer_ip(_req("172.30.0.3")) == ipaddress.ip_address("172.30.0.3")
    assert peer_ip(_req("::ffff:10.0.0.9")) == ipaddress.ip_address("10.0.0.9")
