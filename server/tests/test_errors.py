from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.errors import ApiError
from app.main import create_app


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
