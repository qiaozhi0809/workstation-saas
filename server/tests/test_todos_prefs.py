import pytest
from sqlalchemy import text

from tests.helpers import auth
from tests.seed_ids import ASSISTANT_USER_ID, TEACHER_USER_ID

TODOS = "/api/v1/me/todos"
PREFS = "/api/v1/me/preferences"
T04 = "55555555-5555-5555-5555-555555555541"  # teacher04:既是三年一班班主任,又是 S0002 的主家长
LI = "55555555-5555-5555-5555-555555555561"  # 李家长:纯家长账号
PRINCIPAL = "55555555-5555-5555-5555-555555555543"


@pytest.fixture(autouse=True)
def _fresh_preferences(db):
    """种子把所有账号的首次引导记为已看过(免得 E2E 第一次登录被欢迎页挡住);
    本文件测的是"没有偏好行"的默认值与按语境写入,所以先把种子的偏好行清掉(随测试事务回滚)。"""
    db.execute(text("DELETE FROM user_preferences"))
    db.flush()


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
    assert body["onboarded"] == {}  # 没有偏好行也返回完整的 onboarded


def test_preferences_roundtrip_is_per_user(client, settings):
    mine = {
        "teacher_figure": "male",
        "idle_animation": False,
        "review_reasons": [{"text": "回答问题", "delta": 1}],
    }
    assert client.put(PREFS, json=mine, headers=auth(settings)).json() == {**mine, "onboarded": {}}
    assert client.get(PREFS, headers=auth(settings)).json() == {**mine, "onboarded": {}}
    other = client.get(PREFS, headers=auth(settings, ASSISTANT_USER_ID)).json()
    assert other["teacher_figure"] == "female"


BASE = {
    "teacher_figure": "female",
    "idle_animation": True,
    "review_reasons": [{"text": "积极发言", "delta": 1}],
}
T1 = "2026-11-06T01:00:00Z"
T2 = "2026-11-06T02:00:00Z"
T3 = "2026-11-06T03:00:00Z"


def _put(client, settings, who, onboarded=None, **extra):
    body = {**BASE, **extra}
    if onboarded is not None:
        body["onboarded"] = onboarded
    return client.put(PREFS, json=body, headers=auth(settings, who))


def _get(client, settings, who):
    return client.get(PREFS, headers=auth(settings, who)).json()["onboarded"]


def test_onboarded_per_context(client, settings):
    """R7:状态存后端、按语境分开;只能写自己拥有的语境;PUT 是合并不是覆盖;不带则不动。"""
    # teacher04 同时是老师与家长:两个语境各自记一次
    res = _put(client, settings, T04, {"teacher": T1})
    assert res.status_code == 200, res.text
    assert res.json()["onboarded"] == {"teacher": T1}
    res = _put(client, settings, T04, {"parent": T2})
    assert res.status_code == 200
    assert res.json()["onboarded"] == {"teacher": T1, "parent": T2}  # 合并,不覆盖 teacher
    assert _get(client, settings, T04) == {"teacher": T1, "parent": T2}

    # 不是自己的语境 → 400,什么都不改
    res = _put(client, settings, T04, {"admin": T3})
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"
    res = _put(client, settings, T04, {"teacher": T3, "admin": T3})
    assert res.status_code == 400
    assert _get(client, settings, T04) == {"teacher": T1, "parent": T2}
    # 不认识的键也是 400
    assert _put(client, settings, T04, {"student": T3}).status_code == 400
    assert _put(client, settings, T04, {"teacher": "昨天"}).status_code == 400
    # 不带时区的时间也是 400(审查第 1 轮:AwareDatetime,不让裸时间原样落进 JSONB)
    assert _put(client, settings, T04, {"teacher": "2026-11-06T01:00:00"}).status_code == 400
    assert _get(client, settings, T04) == {"teacher": T1, "parent": T2}

    # 不带 onboarded(或 null):其他偏好照存,onboarded 不动
    res = _put(client, settings, T04, teacher_figure="male")
    assert res.status_code == 200
    assert res.json()["teacher_figure"] == "male"
    assert res.json()["onboarded"] == {"teacher": T1, "parent": T2}
    res = client.put(PREFS, json={**BASE, "onboarded": None}, headers=auth(settings, T04))
    assert res.status_code == 200 and res.json()["onboarded"] == {"teacher": T1, "parent": T2}
    # 同一个键再写:只更新这个键
    assert _put(client, settings, T04, {"teacher": T3}).json()["onboarded"] == {
        "teacher": T3,
        "parent": T2,
    }
    # 空对象:合法,不改任何键
    assert _put(client, settings, T04, {}).json()["onboarded"] == {"teacher": T3, "parent": T2}

    # 纯家长账号只能写 parent
    assert _put(client, settings, LI, {"parent": T1}).json()["onboarded"] == {"parent": T1}
    assert _put(client, settings, LI, {"teacher": T1}).status_code == 400
    # 纯老师账号写不了 parent;管理员能写 admin
    assert _put(client, settings, TEACHER_USER_ID, {"parent": T1}).status_code == 400
    assert _put(client, settings, PRINCIPAL, {"admin": T1}).json()["onboarded"] == {"admin": T1}
    # 各人各自的状态互不影响
    assert _get(client, settings, LI) == {"parent": T1}
    assert _get(client, settings, TEACHER_USER_ID) == {}


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
