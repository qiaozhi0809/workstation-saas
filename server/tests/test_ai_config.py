import base64
import io
from dataclasses import dataclass

import pytest
from sqlalchemy import select

from app.cli import ai_config as run_ai_config
from app.cli import build_parser
from app.models.audit import AuditLog
from tests.fake_llm import sse_transport
from tests.helpers import auth


@dataclass
class CliResult:
    code: int
    text: str


@pytest.fixture(autouse=True)
def _cli_settings(monkeypatch, settings):
    monkeypatch.setattr("app.cli.get_settings", lambda: settings)


def run_cli(db, argv, stdin="", transport=None) -> CliResult:
    import contextlib

    ns = build_parser().parse_args(argv)

    @contextlib.contextmanager
    def scope():
        yield db

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = run_ai_config(ns, db_factory=scope, stdin=io.StringIO(stdin), transport=transport)
    return CliResult(code, buf.getvalue())


def _set_deepseek(db):
    return run_cli(
        db,
        ["ai-config", "set", "--provider", "deepseek", "--api-key-stdin"],
        stdin="sk-test-0000\n",
    )


def test_set_show_and_status(db, client, settings):
    out = _set_deepseek(db)
    assert out.code == 0 and "API Key:已设置(…0000)" in out.text and "sk-test-0000" not in out.text
    assert out.text.startswith("已保存")
    r = client.get("/api/v1/ai/status", headers=auth(settings))
    assert r.json() == {
        "configured": True,
        "provider_label": "DeepSeek · deepseek-flash",
        "mask_forced": False,
    }


def test_show_unconfigured(db):
    out = run_cli(db, ["ai-config", "show"])
    assert out.code == 0 and out.text.strip() == "尚未配置 AI 服务"


def test_show_lines(db):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "show"])
    assert "服务商:DeepSeek(deepseek)" in out.text
    assert "地址:https://api.deepseek.com" in out.text
    assert "模型:deepseek-flash" in out.text
    assert "temperature:0.7" in out.text
    assert "强制隐去姓名:否" in out.text


def test_custom_requires_base_url_and_model(db):
    assert run_cli(db, ["ai-config", "set", "--provider", "custom"]).code == 2
    assert (
        run_cli(db, ["ai-config", "set", "--provider", "custom", "--base-url", "http://x/v1"]).code
        == 2
    )
    ok = run_cli(
        db,
        ["ai-config", "set", "--provider", "custom", "--base-url", "http://localhost:1/v1"]
        + ["--model", "m"],
    )
    assert ok.code == 0


def test_set_without_provider_and_config_is_usage_error(db):
    assert run_cli(db, ["ai-config", "set", "--model", "x"]).code == 2


def test_temperature_range(db):
    assert run_cli(db, ["ai-config", "set", "--provider", "qwen", "--temperature", "2"]).code == 2
    assert run_cli(db, ["ai-config", "set", "--provider", "qwen", "--temperature", "1.5"]).code == 0


def test_provider_change_resets_preset(db):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "set", "--provider", "qwen"])
    assert out.code == 0 and "模型:qwen-plus" in out.text
    assert "API Key:未设置" in out.text  # 换服务商,旧 Key 清除
    assert "已更换服务商或地址,原 API Key 已清除,请用 --api-key-stdin 重新设置" in out.text
    out = run_cli(db, ["ai-config", "set", "--provider", "deepseek", "--model", "m2"])
    assert "模型:m2" in out.text


def test_provider_switch_with_new_key_keeps_new_key(db):
    _set_deepseek(db)
    out = run_cli(
        db, ["ai-config", "set", "--provider", "qwen", "--api-key-stdin"], stdin="sk-test-1111\n"
    )
    assert "API Key:已设置(…1111)" in out.text and "已更换" not in out.text


def test_base_url_host_change_drops_key(db):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "set", "--base-url", "https://evil.example.test/v1"])
    assert "API Key:未设置" in out.text and "原 API Key 已清除" in out.text


def test_model_only_change_keeps_key(db):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "set", "--model", "m2"])
    assert "API Key:已设置(…0000)" in out.text and "已更换" not in out.text


def test_hint_shown_when_model_empty(db):
    out = run_cli(db, ["ai-config", "set", "--provider", "doubao"])
    assert out.text.strip().splitlines()[-1].startswith("提示:模型名填方舟控制台")
    assert "提示:" in run_cli(db, ["ai-config", "show"]).text


def test_wrong_master_key_does_not_lock_out(db, client, settings, monkeypatch):
    _set_deepseek(db)
    other = settings.model_copy(update={"master_key": base64.b64encode(b"b" * 32).decode()})
    monkeypatch.setattr("app.cli.get_settings", lambda: other)
    app_dep = client.app.dependency_overrides
    from app.config import settings_dep

    app_dep[settings_dep] = lambda: other
    try:
        st = client.get("/api/v1/ai/status", headers=auth(settings))
        assert st.status_code == 200 and st.json()["configured"] is False
    finally:
        app_dep.pop(settings_dep, None)
    shown = run_cli(db, ["ai-config", "show"])
    assert shown.code == 0 and "API Key:无法解密(主密钥可能已更换),请重新设置" in shown.text
    assert run_cli(db, ["ai-config", "test"]).code == 1
    fixed = run_cli(db, ["ai-config", "set", "--api-key-stdin"], stdin="sk-test-2222\n")
    assert fixed.code == 0 and "API Key:已设置(…2222)" in fixed.text
    assert run_cli(db, ["ai-config", "clear"]).code == 0


def test_empty_stdin_key_deletes_key(db):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "set", "--api-key-stdin"], stdin="  \n")
    assert "API Key:未设置" in out.text


def test_mask_forced_flag(db, client, settings):
    _set_deepseek(db)
    run_cli(db, ["ai-config", "set", "--mask-forced"])
    assert client.get("/api/v1/ai/status", headers=auth(settings)).json()["mask_forced"] is True
    run_cli(db, ["ai-config", "set", "--no-mask-forced"])
    assert client.get("/api/v1/ai/status", headers=auth(settings)).json()["mask_forced"] is False


def test_test_command_success_and_failure(db):
    assert run_cli(db, ["ai-config", "test"]).code == 1  # 未配置
    _set_deepseek(db)
    ok = run_cli(db, ["ai-config", "test"], transport=sse_transport(["连接", "成功"]))
    assert ok.code == 0 and "连接成功,用时" in ok.text and "回复:连接成功" in ok.text
    bad = run_cli(db, ["ai-config", "test"], transport=sse_transport([], status=401))
    assert bad.code == 1 and "连接失败:" in bad.text and "API Key 无效" in bad.text


def test_clear(db, client, settings):
    _set_deepseek(db)
    out = run_cli(db, ["ai-config", "clear"])
    assert out.code == 0 and out.text.strip() == "已清除"
    assert client.get("/api/v1/ai/status", headers=auth(settings)).json() == {
        "configured": False,
        "provider_label": None,
        "mask_forced": False,
    }


def test_config_audited_without_key(db):
    _set_deepseek(db)
    run_cli(db, ["ai-config", "set", "--temperature", "0.3"])
    run_cli(db, ["ai-config", "clear"])
    rows = list(db.scalars(select(AuditLog).where(AuditLog.action == "ai.config")).all())
    assert len(rows) == 3  # at 同一事务内相同,按内容而非顺序断言
    assert all(r.user_id is None and r.extra["via"] == "cli" for r in rows)
    extras = [r.extra for r in rows]
    assert {
        "provider": "deepseek",
        "model": "deepseek-flash",
        "key_changed": True,
        "via": "cli",
    } in extras
    assert {
        "provider": "deepseek",
        "model": "deepseek-flash",
        "key_changed": False,
        "via": "cli",
    } in extras
    assert {"cleared": True, "via": "cli"} in extras
    assert "sk-test-0000" not in str([r.extra for r in rows])


def test_status_requires_login(client):
    assert client.get("/api/v1/ai/status").status_code == 401
