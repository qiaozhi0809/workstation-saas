import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.usefixtures("dev_env")  # L205:这些测试经 get_settings() 读环境,显式要 dev


def test_healthz():
    client = TestClient(create_app())
    res = client.get("/api/v1/healthz")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
