import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.errors import ApiError
from app.main import create_app

pytestmark = pytest.mark.usefixtures("dev_env")  # L205:这些测试经 get_settings() 读环境,显式要 dev


class Body(BaseModel):
    name: str


def make_client() -> TestClient:
    app = create_app()

    @app.get("/boom")
    def boom():
        raise ApiError(409, "CONFLICT_THING", "thing conflicts", {"id": "x"})

    @app.post("/echo")
    def echo(body: Body):
        return body

    return TestClient(app)


def test_api_error_shape():
    res = make_client().get("/boom")
    assert res.status_code == 409
    assert res.json() == {
        "error": {"code": "CONFLICT_THING", "message": "thing conflicts", "details": {"id": "x"}}
    }


def test_validation_error_is_400():
    res = make_client().post("/echo", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "BAD_REQUEST"


def test_unknown_route_is_404_with_shape():
    res = make_client().get("/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_unhandled_exception_is_500_with_envelope():
    app = create_app()

    @app.get("/crash")
    def crash():
        raise RuntimeError("secret detail")

    res = TestClient(app, raise_server_exceptions=False).get("/crash")
    assert res.status_code == 500
    assert res.json() == {"error": {"code": "INTERNAL", "message": "服务器内部错误"}}
    assert "secret detail" not in res.text


def test_api_error_headers():
    app = create_app()

    @app.get("/slow")
    def slow():
        raise ApiError(429, "SLOW", "slow down", headers={"Retry-After": "7"})

    res = TestClient(app).get("/slow")
    assert res.status_code == 429
    assert res.headers["Retry-After"] == "7"
    assert res.json()["error"]["code"] == "SLOW"
