from fastapi.testclient import TestClient

from app.main import create_app


def test_healthz():
    client = TestClient(create_app())
    res = client.get("/api/v1/healthz")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
