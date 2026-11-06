import base64
import json
import socket
import threading
import time
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.config import Settings
from app.crypto import CryptoError, decrypt
from app.domain.cameras import service
from app.domain.cameras.schemas import CameraTestResult
from app.domain.school_settings.service import get_switches, save_switches
from app.models.audit import AuditLog
from app.models.cameras import Camera
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, SCHOOL_ID, TEACHER_USER_ID

IT_ADMIN = "55555555-5555-5555-5555-555555555546"
DEAN = "55555555-5555-5555-5555-555555555544"
PARENT = "55555555-5555-5555-5555-555555555561"
URL = "/api/v1/admin/cameras"
PW = "campass-test"
JPEG_B64 = base64.b64encode(b"\xff\xd8\xff\xe0fake-jpeg").decode()
USER = "camuser"


@pytest.fixture(autouse=True)
def _dns(monkeypatch):
    """不真连 DNS:cam.example.test → 内网,pub.example.test → 公网,其余按字面 IP。"""
    real = socket.getaddrinfo
    table = {"cam.example.test": "10.0.0.9", "pub.example.test": "203.0.113.5"}

    def fake(host, port, *a, **kw):
        if host in table:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (table[host], 0))]
        return real(host, port, *a, **kw)

    monkeypatch.setattr(socket, "getaddrinfo", fake)


def _monitor(db, on=True):
    sw = get_switches(db, UUID(SCHOOL_ID))
    save_switches(db, UUID(SCHOOL_ID), UUID(IT_ADMIN), sw.model_copy(update={"monitor": on}))


@pytest.fixture
def on(db):
    _monitor(db, True)


def body(**kw):
    base = {
        "name": "一楼走廊",
        "class_id": None,
        "location": "走廊",
        "rtsp_url": "rtsp://10.0.0.21/live/1",
        "enabled": True,
        "transcode": False,
    }
    base.update(kw)
    return base


def _create(client, settings, **kw):
    res = client.post(URL, headers=auth(settings, IT_ADMIN), json=body(**kw))
    assert res.status_code == 201, res.text
    return res.json()


def _row(db, cid) -> Camera:
    db.expire_all()
    return db.get(Camera, UUID(cid))


def _walk(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


# ---- 权限 / 开关 ----


def test_it_admin_crud(client, settings, db, on):
    h = auth(settings, IT_ADMIN)
    created = _create(client, settings, class_id=CLASS_ID, location="教室")
    cid = created["id"]
    assert created["rtsp_url"] == "rtsp://10.0.0.21/live/1"
    assert created["class_name"]
    assert created["status"] == "idle" and created["last_error"] is None
    assert created["has_credentials"] is False
    listed = client.get(URL, headers=h)
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()] == [cid]
    put = client.put(f"{URL}/{cid}", headers=h, json=body(name="改名", enabled=False))
    assert put.status_code == 200 and put.json()["name"] == "改名"
    assert put.json()["enabled"] is False
    assert client.delete(f"{URL}/{cid}", headers=h).status_code == 204
    assert client.get(URL, headers=h).json() == []
    actions = {r.action for r in audit_rows(db, cid)}
    assert {"camera.create", "camera.update", "camera.delete"} <= actions


@pytest.mark.parametrize("user", [DEAN, TEACHER_USER_ID, PARENT])
def test_other_roles_403(client, settings, db, on, user):
    h = auth(settings, user)
    assert client.get(URL, headers=h).status_code == 403
    assert client.post(URL, headers=h, json=body()).status_code == 403
    assert client.get(f"{URL}/health", headers=h).status_code == 403
    assert client.delete(f"{URL}/{uuid4()}", headers=h).status_code == 403
    assert client.post(f"{URL}/{uuid4()}/test", headers=h).status_code == 403


def test_switch_off_404(client, settings, db, redis_client):
    h = auth(settings, IT_ADMIN)
    assert get_switches(db, UUID(SCHOOL_ID)).monitor is False
    assert client.get(URL, headers=h).status_code == 404
    assert client.post(URL, headers=h, json=body()).status_code == 404
    assert client.put(f"{URL}/{uuid4()}", headers=h, json=body()).status_code == 404
    assert client.delete(f"{URL}/{uuid4()}", headers=h).status_code == 404
    assert client.post(f"{URL}/{uuid4()}/test", headers=h).status_code == 404
    res = client.get(f"{URL}/health", headers=h)
    assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FOUND"


def test_unknown_camera_404(client, settings, on):
    h = auth(settings, IT_ADMIN)
    assert client.put(f"{URL}/{uuid4()}", headers=h, json=body()).status_code == 404
    assert client.delete(f"{URL}/{uuid4()}", headers=h).status_code == 404
    assert client.post(f"{URL}/{uuid4()}/test", headers=h).status_code == 404


def test_unknown_class_404(client, settings, on):
    res = client.post(URL, headers=auth(settings, IT_ADMIN), json=body(class_id=str(uuid4())))
    assert res.status_code == 404


# ---- 凭据 ----


def test_camera_out_has_no_secret(client, settings, db, on):
    h = auth(settings, IT_ADMIN)
    created = _create(client, settings, username=USER, password=PW)
    cid = created["id"]
    assert created["has_credentials"] is True
    listed = client.get(URL, headers=h).json()
    for payload in (created, listed, client.get(URL, headers=h).text):
        text = json.dumps(payload) if not isinstance(payload, str) else payload
        assert PW not in text and USER not in text
    keys = set(_walk(created)) | set(_walk(listed))
    assert "password" not in keys and "username" not in keys
    assert "rtsp_username" not in keys and "rtsp_password" not in keys
    row = _row(db, cid)
    assert row.rtsp_password.startswith("v2:") and row.rtsp_username.startswith("v2:")
    assert PW not in row.rtsp_password and USER not in row.rtsp_username
    key = Settings(_env_file=None).master_key_bytes  # 与测试 settings 同为开发主密钥
    assert decrypt(row.rtsp_password, key, aad=f"camera:{cid}:password") == PW
    assert decrypt(row.rtsp_username, key, aad=f"camera:{cid}:username") == USER
    with pytest.raises(CryptoError):
        decrypt(row.rtsp_password, key, aad=f"camera:{uuid4()}:password")
    with pytest.raises(CryptoError):
        decrypt(row.rtsp_password, key, aad=f"camera:{cid}:username")


def test_credentials_omit_null_set(client, settings, db, on):
    h = auth(settings, IT_ADMIN)
    cid = _create(client, settings, username=USER, password=PW)["id"]
    key = Settings(_env_file=None).master_key_bytes
    old_user = _row(db, cid).rtsp_username
    # 省略 = 不改
    res = client.put(f"{URL}/{cid}", headers=h, json=body(name="x"))
    assert res.json()["has_credentials"] is True
    assert _row(db, cid).rtsp_username == old_user
    # null = 清除用户名,密码保留
    res = client.put(f"{URL}/{cid}", headers=h, json=body(username=None))
    row = _row(db, cid)
    assert row.rtsp_username is None and row.rtsp_password is not None
    assert res.json()["has_credentials"] is True
    # 设置新值
    client.put(f"{URL}/{cid}", headers=h, json=body(username="camuser2", password="campass-test2"))
    row = _row(db, cid)
    assert decrypt(row.rtsp_username, key, aad=f"camera:{cid}:username") == "camuser2"
    assert decrypt(row.rtsp_password, key, aad=f"camera:{cid}:password") == "campass-test2"
    # 全部清除
    res = client.put(f"{URL}/{cid}", headers=h, json=body(username=None, password=None))
    assert res.json()["has_credentials"] is False
    assert _row(db, cid).rtsp_password is None


def test_audit_has_no_secrets(client, settings, db, on):
    h = auth(settings, IT_ADMIN)
    cid = _create(
        client, settings, username=USER, password=PW, rtsp_url="rtsp://10.0.0.21/live/1?token=tk9"
    )["id"]
    client.put(f"{URL}/{cid}", headers=h, json=body(password="campass-test3"))
    client.delete(f"{URL}/{cid}", headers=h)
    rows = list(db.scalars(select(AuditLog).where(AuditLog.action.like("camera.%"))).all())
    assert rows
    blob = json.dumps(
        [[r.action, r.object_id, r.extra] for r in rows], ensure_ascii=False, default=str
    )
    for secret in (PW, "campass-test3", USER, "tk9", "rtsp://"):
        assert secret not in blob


# ---- 地址 ----


def test_rtsp_url_with_userinfo_rejected(client, settings, db, on):
    res = client.post(
        URL,
        headers=auth(settings, IT_ADMIN),
        json=body(rtsp_url=f"rtsp://{USER}:{PW}@10.0.0.21/x"),
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "RTSP_URL_HAS_CREDENTIALS"
    assert PW not in res.text
    assert db.scalars(select(Camera)).first() is None


def test_rtsp_url_errors(client, settings, on):
    h = auth(settings, IT_ADMIN)

    def code(url):
        res = client.post(URL, headers=h, json=body(rtsp_url=url))
        assert res.status_code == 400
        return res.json()["error"]["code"]

    assert code("http://10.0.0.21/x") == "RTSP_URL_INVALID"
    assert code("rtsp://pub.example.test/x") == "RTSP_URL_NOT_LAN"
    assert code("rtsp://8.8.8.8/x") == "RTSP_URL_NOT_LAN"
    put = client.put(f"{URL}/{uuid4()}", headers=h, json=body(rtsp_url="http://10.0.0.1/x"))
    assert put.status_code == 400


def test_rtsp_url_in_trusted_network_rejected(pg_url, redis_url, db, redis_client, on):
    """L159:解析到 WS_TRUSTED_PROXIES(compose 子网)的地址虽是私网也拒绝,
    堵住借"测试连接"探测容器端口。"""
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import create_app
    from app.redis import get_redis
    from tests.conftest import TEST_JWT_SECRET

    cfg = Settings(
        _env_file=None,
        env="dev",
        database_url=pg_url,
        redis_url=redis_url,
        jwt_secret=TEST_JWT_SECRET,
        trusted_proxies=["172.30.0.0/24"],
    )
    app = create_app(cfg)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    c = TestClient(app)
    h = auth(cfg, IT_ADMIN)
    res = c.post(URL, headers=h, json=body(rtsp_url="rtsp://172.30.0.5:5432/x"))
    assert res.status_code == 400 and res.json()["error"]["code"] == "RTSP_URL_NOT_LAN"
    assert db.scalars(select(Camera)).first() is None
    ok = c.post(URL, headers=h, json=body(rtsp_url="rtsp://192.168.1.10/live/1"))
    assert ok.status_code == 201, ok.text
    put = c.put(f"{URL}/{ok.json()['id']}", headers=h, json=body(rtsp_url="rtsp://172.30.0.9/x"))
    assert put.status_code == 400 and put.json()["error"]["code"] == "RTSP_URL_NOT_LAN"


def test_loopback_allowed_only_in_dev(client, settings, on):
    assert settings.env == "dev"
    res = client.post(
        URL, headers=auth(settings, IT_ADMIN), json=body(rtsp_url="rtsp://127.0.0.1:8554/cam1")
    )
    assert res.status_code == 201


def test_input_validation(client, settings, on):
    h = auth(settings, IT_ADMIN)
    assert client.post(URL, headers=h, json=body(name="")).status_code == 400
    assert client.post(URL, headers=h, json=body(name="x" * 31)).status_code == 400
    assert client.post(URL, headers=h, json=body(location="天台")).status_code == 400


# ---- Redis ----


def test_update_publishes_reload_only_when_changed(client, settings, db, on, redis_client):
    h = auth(settings, IT_ADMIN)
    cid = _create(client, settings, username=USER, password=PW)["id"]
    ps = redis_client.pubsub()
    ps.subscribe("ws:cam:reload")
    ps.get_message(timeout=1)  # 订阅确认

    def drain():
        out = []
        while (m := ps.get_message(timeout=0.3)) is not None:
            if m["type"] == "message":
                out.append(m["data"])
        return out

    client.put(f"{URL}/{cid}", headers=h, json=body(name="只改名", username=USER, password=PW))
    assert drain() == []
    # 启用 / 转码变化也要通知 worker
    for kw in ({"enabled": False}, {"enabled": True}, {"transcode": True}, {"transcode": False}):
        r = client.put(f"{URL}/{cid}", headers=h, json=body(username=USER, password=PW, **kw))
        assert r.status_code == 200, r.text
        assert drain() == [cid], kw
    client.put(f"{URL}/{cid}", headers=h, json=body(rtsp_url="rtsp://10.0.0.22/live/2"))
    assert drain() == [cid]
    client.put(f"{URL}/{cid}", headers=h, json=body(rtsp_url="rtsp://10.0.0.22/live/2"))
    assert drain() == []
    client.put(
        f"{URL}/{cid}",
        headers=h,
        json=body(rtsp_url="rtsp://10.0.0.22/live/2", password="campass-test2"),
    )
    assert drain() == [cid]
    client.delete(f"{URL}/{cid}", headers=h)
    assert drain() == [cid]


def test_status_from_redis(client, settings, on, redis_client):
    h = auth(settings, IT_ADMIN)
    cid = _create(client, settings)["id"]
    redis_client.hset(
        f"ws:cam:state:{cid}",
        mapping={"status": "error", "last_error": "连接失败 rtsp://u:p@10.0.0.21/x?password=zz"},
    )
    cam = client.get(URL, headers=h).json()[0]
    assert cam["status"] == "error"
    assert "zz" not in cam["last_error"] and "u:p" not in cam["last_error"]
    redis_client.hset(f"ws:cam:state:{cid}", mapping={"status": "streaming", "last_error": ""})
    cam = client.get(URL, headers=h).json()[0]
    assert cam["status"] == "streaming" and cam["last_error"] is None
    redis_client.hset(f"ws:cam:state:{cid}", mapping={"status": "weird"})
    assert client.get(URL, headers=h).json()[0]["status"] == "idle"


def test_health(client, settings, on, redis_client):
    h = auth(settings, IT_ADMIN)
    assert client.get(f"{URL}/health", headers=h).json() == {"public_hosts": []}
    redis_client.set("ws:cam:public_hosts", json.dumps(["pub.example.test"]))
    assert client.get(f"{URL}/health", headers=h).json() == {"public_hosts": ["pub.example.test"]}
    redis_client.set("ws:cam:public_hosts", "not json")
    assert client.get(f"{URL}/health", headers=h).json() == {"public_hosts": []}


def test_list_sorting(client, settings, db, on):
    from tests.factories import make_class

    cls_b = make_class(db, "二班")
    cls_a = make_class(db, "一班")
    _create(client, settings, name="pub-b", class_id=None, location="操场")
    _create(client, settings, name="cam-b", class_id=str(cls_b))
    _create(client, settings, name="cam-a", class_id=str(cls_b))
    _create(client, settings, name="cam-c", class_id=str(cls_a))
    _create(client, settings, name="pub-a", class_id=None, location="走廊")
    names = [c["name"] for c in client.get(URL, headers=auth(settings, IT_ADMIN)).json()]
    assert names == ["cam-c", "cam-a", "cam-b", "pub-a", "pub-b"]


# ---- 测试连接 ----


def _fake_worker(redis_client, result: dict | None, seen: list):
    def run():
        item = redis_client.blpop("ws:cam:probe", timeout=5)
        if item is None:
            return
        task = json.loads(item[1])
        seen.append(task)
        if result is not None:
            redis_client.set(task["reply_key"], json.dumps(result), ex=30)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


@pytest.fixture
def peer_client(settings, db, redis_client):
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import create_app
    from app.redis import get_redis

    def make(peer):
        app = create_app(settings)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_redis] = lambda: redis_client
        app.state.ai_transport = None
        return TestClient(app, client=peer)

    return make


PREVIEW_REPLY = {"ok": True, "message": "连接成功", "preview_jpeg_base64": JPEG_B64, "probe": None}
HEVC_PROBE = {
    "video_codec": "hevc",
    "width": 2560,
    "height": 1440,
    "fps": 25.0,
    "bitrate_kbps": 6144,
    "audio_codec": None,
    "browser_playable": False,
    "hint": "该摄像头是 H.265(HEVC)编码(测试文案)",
}


@pytest.mark.parametrize(
    "peer, shown",
    [(("10.0.0.5", 5000), True), (("8.8.8.8", 5000), False), (("testclient", 5000), False)],
)
def test_camera_test_preview_only_on_lan(peer_client, settings, db, on, redis_client, peer, shown):
    cid = _create(peer_client(("10.0.0.5", 1)), settings, username=USER, password=PW)["id"]
    t = _fake_worker(redis_client, PREVIEW_REPLY, [])
    res = peer_client(peer).post(f"{URL}/{cid}/test", headers=auth(settings, IT_ADMIN))
    t.join(5)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["ok"] is True
    if shown:
        assert out == PREVIEW_REPLY
    else:
        assert out["preview_jpeg_base64"] is None
        assert out["message"] == "连接成功;预览图只在校园网内显示"


def test_camera_test_session_released_before_probe_wait(
    peer_client, settings, db, on, redis_client, monkeypatch
):
    cid = _create(peer_client(("10.0.0.5", 1)), settings)["id"]
    monkeypatch.setattr(service, "PROBE_TIMEOUT", 0.6)
    seen = []
    real_sleep = time.sleep

    def hook(s):  # 每次轮询之间:会话不能还在事务里(连接已归还)
        seen.append(db.in_transaction())
        real_sleep(min(s, 0.05))

    monkeypatch.setattr(service.time, "sleep", hook)
    res = peer_client(("10.0.0.5", 1)).post(f"{URL}/{cid}/test", headers=auth(settings, IT_ADMIN))
    assert res.status_code == 200
    assert res.json()["message"] == "转流服务没有响应"
    assert seen and not any(seen), seen
    redis_client.delete("ws:cam:probe")


def test_camera_test_with_fake_worker(client, settings, db, on, redis_client):
    h = auth(settings, IT_ADMIN)
    cid = _create(client, settings, username=USER, password=PW)["id"]
    seen: list = []
    t = _fake_worker(
        redis_client, {"ok": True, "message": "连接成功", "preview_jpeg_base64": JPEG_B64}, seen
    )
    res = client.post(f"{URL}/{cid}/test", headers=h)
    t.join(5)
    assert res.status_code == 200, res.text
    assert res.json()["ok"] is True and res.json()["preview_jpeg_base64"] is None  # 非内网来源
    assert res.json()["probe"] is None  # 旧 worker 回写没有 probe 键也能解析
    assert seen[0]["id"] == cid
    assert seen[0]["reply_key"].startswith("ws:cam:probe:reply:")
    assert PW not in json.dumps(seen[0]) and USER not in json.dumps(seen[0])
    assert redis_client.exists(seen[0]["reply_key"]) == 0  # 取走即删
    rows = [r for r in audit_rows(db, cid) if r.action == "camera.test"]
    assert len(rows) == 1 and rows[0].success is True


def test_camera_test_no_reply(client, settings, db, on, redis_client, monkeypatch):
    monkeypatch.setattr(service, "PROBE_TIMEOUT", 0.5)
    cid = _create(client, settings)["id"]
    res = client.post(f"{URL}/{cid}/test", headers=auth(settings, IT_ADMIN))
    assert res.status_code == 200
    assert res.json() == {
        "ok": False,
        "message": "转流服务没有响应",
        "preview_jpeg_base64": None,
        "probe": None,
    }
    rows = [r for r in audit_rows(db, cid) if r.action == "camera.test"]
    assert len(rows) == 1 and rows[0].success is False
    redis_client.delete("ws:cam:probe")


def test_camera_test_reply_with_probe(peer_client, settings, db, on, redis_client):
    """worker 回写带 probe(编解码探测):原样返回;预览图按来源过滤,probe 不受影响。"""
    cid = _create(peer_client(("10.0.0.5", 1)), settings)["id"]
    reply = {**PREVIEW_REPLY, "probe": HEVC_PROBE}
    for peer, shown in ((("10.0.0.5", 5000), True), (("8.8.8.8", 5000), False)):
        t = _fake_worker(redis_client, reply, [])
        res = peer_client(peer).post(f"{URL}/{cid}/test", headers=auth(settings, IT_ADMIN))
        t.join(5)
        assert res.status_code == 200, res.text
        out = res.json()
        assert out["ok"] is True and out["probe"] == HEVC_PROBE
        assert (out["preview_jpeg_base64"] is not None) is shown
    # 直接解析 worker 的 JSON:有 probe、无 probe、probe 为 null 都行
    parsed = CameraTestResult.model_validate_json(json.dumps(reply))
    assert parsed.probe is not None and parsed.probe.video_codec == "hevc"
    assert parsed.probe.browser_playable is False and parsed.probe.audio_codec is None
    legacy = CameraTestResult.model_validate_json(
        json.dumps({"ok": True, "message": "连接成功", "preview_jpeg_base64": None})
    )
    assert legacy.probe is None
    assert CameraTestResult.model_validate_json(json.dumps(PREVIEW_REPLY)).probe is None


def test_service_test_camera_timeout_injectable(db, redis_client):
    cam = Camera(
        school_id=UUID(SCHOOL_ID),
        name="c",
        location="走廊",
        rtsp_url="rtsp://10.0.0.21/x",
    )
    db.add(cam)
    db.flush()
    started = time.monotonic()
    out = service.test_camera(db, redis_client, cam, timeout=0.4)
    assert isinstance(out, CameraTestResult)
    assert out.ok is False and out.message == "转流服务没有响应"
    assert time.monotonic() - started < 3
    redis_client.delete("ws:cam:probe")


def _reply_via_worker(client, settings, redis_client, cid, reply):
    seen: list = []

    def run():
        item = redis_client.blpop("ws:cam:probe", timeout=5)
        if item is None:
            return
        task = json.loads(item[1])
        redis_client.set(task["reply_key"], reply, ex=30)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    res = client.post(f"{URL}/{cid}/test", headers=auth(settings, IT_ADMIN))
    t.join(5)
    assert seen == []
    return res


@pytest.mark.parametrize(
    "preview",
    [
        "not base64!!",
        base64.b64encode(b"plain text, not a jpeg").decode(),
        base64.b64encode(b"\xff\xd8\xff" + b"0" * 1_000_001).decode(),
    ],
)
def test_probe_preview_rejected(client, settings, on, redis_client, preview):
    cid = _create(client, settings)["id"]
    reply = json.dumps({"ok": True, "message": "连接成功", "preview_jpeg_base64": preview})
    res = _reply_via_worker(client, settings, redis_client, cid, reply)
    assert res.status_code == 200
    assert res.json() == {
        "ok": False,
        "message": "预览数据异常",
        "preview_jpeg_base64": None,
        "probe": None,
    }


def test_probe_garbage_reply(client, settings, on, redis_client):
    cid = _create(client, settings)["id"]
    res = _reply_via_worker(client, settings, redis_client, cid, "\x00garbage{")
    assert res.status_code == 200
    body_ = res.json()
    assert body_["ok"] is False and body_["preview_jpeg_base64"] is None


def test_unauthorised_with_switch_off_is_403(client, settings, db, redis_client):
    assert get_switches(db, UUID(SCHOOL_ID)).monitor is False
    for user in (DEAN, TEACHER_USER_ID, PARENT):
        h = auth(settings, user)
        assert client.get(URL, headers=h).status_code == 403
        assert client.get(f"{URL}/health", headers=h).status_code == 403
        assert client.post(URL, headers=h, json=body()).status_code == 403


@pytest.mark.parametrize(
    "bad", ["rtsp://10.0.0.21/a\nb", "rtsp://10.0.0.21/a\tb", "rtsp://10.0.0.21/a b"]
)
def test_url_with_whitespace_rejected(client, settings, on, bad):
    res = client.post(URL, headers=auth(settings, IT_ADMIN), json=body(rtsp_url=bad))
    assert res.status_code == 400 and res.json()["error"]["code"] == "RTSP_URL_INVALID"


def test_userinfo_trick_is_credentials_error(client, settings, on):
    res = client.post(
        URL, headers=auth(settings, IT_ADMIN), json=body(rtsp_url="rtsp://10.0.0.1@8.8.8.8/x")
    )
    assert res.status_code == 400 and res.json()["error"]["code"] == "RTSP_URL_HAS_CREDENTIALS"
