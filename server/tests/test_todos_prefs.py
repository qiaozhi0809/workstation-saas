from tests.helpers import auth
from tests.seed_ids import ASSISTANT_USER_ID

TODOS = "/api/v1/me/todos"
PREFS = "/api/v1/me/preferences"


def test_todo_crud_and_order(client, settings):
    h = auth(settings)
    first = client.post(TODOS, json={"content": "收秋游回执"}, headers=h)
    assert first.status_code == 201 and first.json()["done"] is False
    client.post(TODOS, json={"content": "准备班会"}, headers=h)
    todo_id = first.json()["id"]
    assert client.patch(f"{TODOS}/{todo_id}", json={"done": True}, headers=h).json()["done"]
    assert [t["content"] for t in client.get(TODOS, headers=h).json()["items"]] == [
        "准备班会",
        "收秋游回执",
    ]
    assert client.delete(f"{TODOS}/{todo_id}", headers=h).status_code == 204
    assert [t["content"] for t in client.get(TODOS, headers=h).json()["items"]] == ["准备班会"]


def test_other_users_todo_is_404(client, settings):
    todo_id = client.post(TODOS, json={"content": "私事"}, headers=auth(settings)).json()["id"]
    other = auth(settings, ASSISTANT_USER_ID)
    assert client.patch(f"{TODOS}/{todo_id}", json={"done": True}, headers=other).status_code == 404
    assert client.delete(f"{TODOS}/{todo_id}", headers=other).status_code == 404


def test_todo_content_validation(client, settings):
    for bad in ("", "   ", "字" * 201):
        res = client.post(TODOS, json={"content": bad}, headers=auth(settings))
        assert res.status_code == 400


def test_preferences_default(client, settings):
    body = client.get(PREFS, headers=auth(settings)).json()
    assert (body["teacher_figure"], body["idle_animation"]) == ("female", True)
    reasons = body["review_reasons"]
    assert len(reasons) == 10
    assert reasons[0] == {"text": "积极发言", "delta": 1}
    assert reasons[-1] == {"text": "违反纪律", "delta": -2}


def test_preferences_roundtrip_is_per_user(client, settings):
    mine = {
        "teacher_figure": "male",
        "idle_animation": False,
        "review_reasons": [{"text": "回答问题", "delta": 1}],
    }
    assert client.put(PREFS, json=mine, headers=auth(settings)).json() == mine
    assert client.get(PREFS, headers=auth(settings)).json() == mine
    other = client.get(PREFS, headers=auth(settings, ASSISTANT_USER_ID)).json()
    assert other["teacher_figure"] == "female"


def test_preferences_validation(client, settings):
    good = {"teacher_figure": "female", "idle_animation": True, "review_reasons": []}
    reason = {"text": "积极发言", "delta": 1}
    for bad in (
        good,
        {**good, "review_reasons": [{"text": "积极发言", "delta": 0}]},
        {**good, "review_reasons": [reason] * 21},
        {**good, "teacher_figure": "robot", "review_reasons": [reason]},
    ):
        assert client.put(PREFS, json=bad, headers=auth(settings)).status_code == 400
