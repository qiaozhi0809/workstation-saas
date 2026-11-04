from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.models import User
from app.models.audit import AuditLog
from tests.fake_llm import sse_transport
from tests.helpers import auth, freeze

USAGE = "/api/v1/admin/ai/usage"
CONFIG = "/api/v1/admin/ai/config"
TEST = "/api/v1/admin/ai/config/test"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER = "55555555-5555-5555-5555-555555555555"
NOW = "2026-10-20T02:00:00+00:00"
KEY = "sk-test-0000-secret"


def _utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


def _gen(db, user: str, at: str, template="lesson", outcome="done", pt=10, ct=20):
    db.add(
        AuditLog(
            at=_utc(at),
            user_id=UUID(user),
            action="ai.generate",
            success=outcome != "error",
            object_type="ai_chat",
            object_id="c1",
            extra={
                "template": template,
                "student_ids": [],
                "provider": "deepseek",
                "model": "m",
                "masked": True,
                "outcome": outcome,
                "prompt_tokens": pt,
                "completion_tokens": ct,
                "chars_in": 5,
                "chars_out": 6,
            },
        )
    )
    db.flush()


def _usage(client, settings, user=PRINCIPAL, **params):
    return client.get(USAGE, params=params, headers=auth(settings, user))


def _name(db, user: str) -> str:
    return db.get(User, UUID(user)).display_name


def _body(provider="deepseek", **kw):
    body = {
        "provider": provider,
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-flash",
        "temperature": 0.7,
        "mask_forced": False,
        "api_key": KEY,
    }
    body.update(kw)
    return body


def _put(client, settings, body, user=IT_ADMIN):
    return client.put(CONFIG, json=body, headers=auth(settings, user))


def test_usage_aggregates(client, db, settings):
    _gen(db, PRINCIPAL, "2026-10-05T02:00:00+00:00", "lesson", pt=10, ct=20)
    _gen(db, PRINCIPAL, "2026-10-06T02:00:00+00:00", "lesson", pt=5, ct=7)
    _gen(db, PRINCIPAL, "2026-10-07T02:00:00+00:00", "no_such_template", pt=1, ct=1)
    _gen(db, PRINCIPAL, "2026-10-08T02:00:00+00:00", "ppt", outcome="error", pt=None, ct=None)
    _gen(db, PRINCIPAL, "2026-10-09T02:00:00+00:00", "ppt", pt=2, ct=2)
    _gen(db, DEAN, "2026-10-10T02:00:00+00:00", "lesson", pt=3, ct=4)
    # 月份之外:9 月最后一刻(本地 9-30 23:59)与 11 月第一刻(本地 11-01 00:00)
    _gen(db, DEAN, "2026-09-30T15:59:59+00:00", "lesson")
    _gen(db, DEAN, "2026-10-31T16:00:00+00:00", "lesson")
    res = _usage(client, settings, month="2026-10")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["month"] == "2026-10"
    p, d = body["rows"]
    assert (p["user_id"], p["display_name"]) == (PRINCIPAL, _name(db, PRINCIPAL))
    assert (p["calls"], p["failed"], p["prompt_tokens"], p["completion_tokens"]) == (5, 1, 18, 30)
    top = p["top_templates"]
    assert [(t["template"], t["count"]) for t in top] == [
        ("lesson", 2),
        ("ppt", 2),
        ("no_such_template", 1),
    ]
    assert top[2]["label"] == "no_such_template"  # 未知模板回原值
    assert [t["label"] for t in top[:2]] == ["备课教案", "课件大纲"]
    assert (d["user_id"], d["calls"], d["failed"]) == (DEAN, 1, 0)
    assert (d["prompt_tokens"], d["completion_tokens"]) == (3, 4)
    assert body["total"] == {"calls": 6, "failed": 1, "prompt_tokens": 21, "completion_tokens": 34}


def test_usage_month_boundary_school_tz(client, db, settings):
    # 2026-09-30T16:30Z = 北京时间 10-01 00:30,属于 10 月
    _gen(db, PRINCIPAL, "2026-09-30T16:30:00+00:00")
    assert _usage(client, settings, month="2026-10").json()["total"]["calls"] == 1
    assert _usage(client, settings, month="2026-09").json()["total"]["calls"] == 0


def test_usage_defaults_to_current_month(client, db, settings, monkeypatch):
    freeze(monkeypatch, "2026-10-31T17:00:00+00:00")  # 本地 11-01 01:00
    _gen(db, PRINCIPAL, "2026-10-31T16:30:00+00:00")
    res = _usage(client, settings)
    assert res.status_code == 200
    assert res.json()["month"] == "2026-11"
    assert res.json()["total"]["calls"] == 1


def test_usage_explicit_month_and_empty(client, settings):
    body = _usage(client, settings, month="2026-03").json()
    assert body == {
        "month": "2026-03",
        "rows": [],
        "total": {"calls": 0, "failed": 0, "prompt_tokens": 0, "completion_tokens": 0},
    }


def test_usage_invalid_month(client, settings):
    for bad in ("2026-13", "2026-1", "abc", "2026-10-01"):
        assert _usage(client, settings, month=bad).status_code == 400


def test_config_roundtrip_never_returns_key(client, db, settings):
    empty = client.get(CONFIG, headers=auth(settings, IT_ADMIN))
    assert empty.status_code == 200
    view = empty.json()
    assert (view["provider"], view["key_set"], view["key_undecryptable"]) == (None, False, False)
    ids = [p["id"] for p in view["providers"]]
    assert "deepseek" in ids and "custom" in ids
    ds = next(p for p in view["providers"] if p["id"] == "deepseek")
    assert ds["base_url"] == "https://api.deepseek.com" and ds["models"] == ["deepseek-flash"]

    # 没有已存 Key 时 api_key=null 是 400
    assert _put(client, settings, _body(api_key=None)).status_code == 400

    res = _put(client, settings, _body(mask_forced=True))
    assert res.status_code == 200, res.text
    assert KEY not in res.text
    saved = res.json()
    assert (saved["provider"], saved["model"], saved["temperature"]) == (
        "deepseek",
        "deepseek-flash",
        0.7,
    )
    assert saved["key_set"] is True and saved["mask_forced"] is True
    got = client.get(CONFIG, headers=auth(settings, IT_ADMIN))
    assert KEY not in got.text and got.json()["key_set"] is True
    assert "api_key" not in got.json()

    # api_key=null 沿用旧 Key
    res = _put(client, settings, _body(api_key=None, model="deepseek-pro", temperature=1.0))
    assert res.status_code == 200
    assert (res.json()["model"], res.json()["key_set"]) == ("deepseek-pro", True)
    from app.ai.settings import load_ai_config

    cfg = load_ai_config(db, settings.school_id, settings.master_key_bytes)
    assert cfg is not None and cfg.api_key == KEY and cfg.temperature == 1.0

    # 非法参数
    assert _put(client, settings, _body(base_url="ftp://x")).status_code == 400
    assert _put(client, settings, _body(base_url="")).status_code == 400
    assert _put(client, settings, _body(temperature=2.5)).status_code == 400
    assert _put(client, settings, _body(temperature=-0.1)).status_code == 400
    assert _put(client, settings, _body(model="")).status_code == 400
    assert _put(client, settings, _body(temperature=2.0)).status_code == 200

    rows = db.scalars(select(AuditLog).where(AuditLog.action == "ai.config")).all()
    assert len(rows) == 3  # 失败的请求不写审计
    assert all(r.user_id == UUID(IT_ADMIN) and r.success for r in rows)
    assert all(KEY not in str(r.extra) and "api_key" not in (r.extra or {}) for r in rows)
    assert all(r.extra["provider"] == "deepseek" for r in rows)
    assert sorted(r.extra["key_changed"] for r in rows) == [False, False, True]

    # 清除
    res = client.delete(CONFIG, headers=auth(settings, IT_ADMIN))
    assert res.status_code == 204
    after = client.get(CONFIG, headers=auth(settings, IT_ADMIN)).json()
    assert (after["provider"], after["key_set"]) == (None, False)
    extras = [r.extra for r in db.scalars(select(AuditLog).where(AuditLog.action == "ai.config"))]
    assert len(extras) == 4 and {"cleared": True} in extras


def test_config_key_undecryptable_flag(client, db, settings):
    from app.models import SchoolSetting

    _put(client, settings, _body())
    row = db.scalars(select(SchoolSetting).where(SchoolSetting.key == "ai")).one()
    row.value = {**row.value, "api_key_enc": "garbage"}
    db.flush()
    view = client.get(CONFIG, headers=auth(settings, IT_ADMIN)).json()
    assert (view["key_set"], view["key_undecryptable"]) == (False, True)


def test_config_test_connection(client, db, settings):
    h = auth(settings, IT_ADMIN)
    client.app.state.ai_transport = sse_transport(["连接", "成功"])
    res = client.post(TEST, json=_body(), headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["ok"] is True and res.json()["message"]

    client.app.state.ai_transport = sse_transport([], status=401)
    res = client.post(TEST, json=_body(), headers=h)
    assert res.status_code == 200
    assert res.json() == {
        "ok": False,
        "message": "AI 服务的 API Key 无效或没有权限,请联系学校管理员",
    }

    client.app.state.ai_transport = sse_transport([], status=404)
    assert "模型名不对" in client.post(TEST, json=_body(), headers=h).json()["message"]

    # api_key=null:没有已存 Key 时 ok=false;有则沿用
    client.app.state.ai_transport = sse_transport(["好"])
    res = client.post(TEST, json=_body(api_key=None), headers=h)
    assert res.json()["ok"] is False
    _put(client, settings, _body())
    sent: list[dict] = []
    client.app.state.ai_transport = sse_transport(["好"], record=sent)
    assert client.post(TEST, json=_body(api_key=None), headers=h).json()["ok"] is True
    assert sent and sent[0]["max_tokens"] <= 50

    # 测试连接不写审计,也不改已存配置
    assert len(db.scalars(select(AuditLog).where(AuditLog.action == "ai.config")).all()) == 1
    assert _put(client, settings, _body(base_url="ftp://x")).status_code == 400
    assert client.post(TEST, json=_body(base_url="ftp://x"), headers=h).status_code == 400


def test_permissions(client, settings):
    for user, usage_ok, config_ok in (
        (PRINCIPAL, True, True),
        (DEAN, True, False),
        (GRADE_HEAD3, False, False),
        (IT_ADMIN, False, True),
        (TEACHER, False, False),
    ):
        h = auth(settings, user)
        assert (client.get(USAGE, headers=h).status_code == 200) is usage_ok, user
        if not usage_ok:
            assert client.get(USAGE, headers=h).status_code == 403
        codes = [
            client.get(CONFIG, headers=h).status_code,
            client.put(CONFIG, json=_body(), headers=h).status_code,
            client.post(TEST, json=_body(), headers=h).status_code,
        ]
        assert all(c != 403 for c in codes) is config_ok, (user, codes)
        if not config_ok:
            assert codes == [403, 403, 403]
            assert client.delete(CONFIG, headers=h).status_code == 403
    assert client.get(USAGE).status_code == 401


def test_config_test_connection_timeout(client, settings, monkeypatch):
    import asyncio

    import httpx

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1)
        return httpx.Response(200)

    monkeypatch.setattr("app.domain.ai_admin.service.TEST_TIMEOUT", 0.05)
    client.app.state.ai_transport = httpx.MockTransport(slow)
    res = client.post(TEST, json=_body(), headers=auth(settings, IT_ADMIN))
    assert res.status_code == 200
    assert res.json()["ok"] is False and "超时" in res.json()["message"]
