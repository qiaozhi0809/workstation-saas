import io
from dataclasses import dataclass

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
    assert "API Key:已设置(…0000)" in out.text  # Key 保留
    out = run_cli(db, ["ai-config", "set", "--provider", "deepseek", "--model", "m2"])
    assert "模型:m2" in out.text


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
    assert len(rows) == 3
    assert all(r.user_id is None and r.extra["via"] == "cli" for r in rows)
    assert rows[0].extra == {
        "provider": "deepseek",
        "model": "deepseek-flash",
        "key_changed": True,
        "via": "cli",
    }
    assert rows[1].extra["key_changed"] is False
    assert rows[2].extra == {"cleared": True, "via": "cli"}
    assert "sk-test-0000" not in str([r.extra for r in rows])


def test_status_requires_login(client):
    assert client.get("/api/v1/ai/status").status_code == 401
