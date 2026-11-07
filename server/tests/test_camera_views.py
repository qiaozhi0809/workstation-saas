"""观看入口(班级摄像头 / 监控墙)遇到 Redis 故障的表现(L292)。

状态只是顺手带的:读状态失败 → 退回 idle 并告警,列表照常给;
真的在路由里冒出 RedisError(不是 _state 吞掉的那种)→ 503 + 中文提示,不是 500。
"""

import pytest
from redis import exceptions as rex
from structlog.testing import capture_logs

from app.domain.cameras import access
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, TEACHER_USER_ID
from tests.test_camera_access import PRINCIPAL, _camera, _monitor

CAMS = f"/api/v1/classes/{CLASS_ID}/cameras"
WALL = "/api/v1/admin/camera-wall"
REDIS_DOWN = {"code": "SERVICE_UNAVAILABLE", "message": "转流服务暂时不可用,请稍后再试"}


@pytest.fixture
def on(db):
    _monitor(db, True)


def _boom(*a, **k):
    raise rex.ConnectionError("Error 111 connecting to redis:6379. Connection refused.")


def test_class_cameras_when_redis_down_returns_idle(
    client, db, settings, redis_client, on, monkeypatch
):
    cam = _camera(db, "三年二班前", CLASS_ID)
    monkeypatch.setattr(redis_client, "hget", _boom)
    with capture_logs() as logs:
        res = client.get(CAMS, headers=auth(settings, TEACHER_USER_ID))
    assert res.status_code == 200, res.text
    assert [(c["id"], c["status"]) for c in res.json()["cameras"]] == [(str(cam.id), "idle")]
    warned = [e for e in logs if e["event"] == "cameras.state_unavailable"]
    assert len(warned) == 1 and warned[0]["log_level"] == "warning"
    assert warned[0]["camera_id"] == str(cam.id) and warned[0]["error"] == "ConnectionError"
    # 监控墙同样退回 idle
    wall = client.get(WALL, headers=auth(settings, PRINCIPAL))
    assert wall.status_code == 200, wall.text
    cams = [c for g in wall.json()["grades"] for cls in g["classes"] for c in cls["cameras"]]
    assert [c["status"] for c in cams] == ["idle"]


def test_view_router_redis_503(client, db, settings, on, monkeypatch):
    """路由里冒出的 RedisError 统一成 503(与管理端 / 拉流接口同一口径,L163)。"""
    _camera(db, "三年二班前", CLASS_ID)
    monkeypatch.setattr(access, "_state", _boom)
    res = client.get(CAMS, headers=auth(settings, TEACHER_USER_ID))
    assert res.status_code == 503, res.text
    assert res.json()["error"] == REDIS_DOWN
    assert res.headers["cache-control"] == "no-store"
    res = client.get(WALL, headers=auth(settings, PRINCIPAL))
    assert res.status_code == 503 and res.json()["error"] == REDIS_DOWN
