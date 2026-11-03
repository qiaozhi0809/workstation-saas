from dataclasses import dataclass


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    base_url: str
    model: str
    hint: str | None = None


# 模型名以服务商控制台为准,`ai-config set --model` 可覆盖。
PRESETS: dict[str, Preset] = {
    p.id: p
    for p in (
        Preset(
            "deepseek",
            "DeepSeek",
            "https://api.deepseek.com",
            "deepseek-flash",
            "需要更强推理时可把模型改成服务商提供的推理模型",
        ),
        Preset(
            "qwen",
            "通义千问(阿里云百炼)",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "qwen-plus",
        ),
        Preset("kimi", "Kimi(月之暗面)", "https://api.moonshot.cn/v1", "kimi-k3"),
        Preset(
            "glm",
            "智谱 GLM",
            "https://open.bigmodel.cn/api/paas/v4",
            "glm-4-flash",
            "glm-4-flash 是免费模型",
        ),
        Preset(
            "doubao",
            "豆包(火山方舟)",
            "https://ark.cn-beijing.volces.com/api/v3",
            "",
            "模型名填方舟控制台里的模型 ID 或推理接入点 ID",
        ),
        Preset("silicon", "硅基流动", "https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V3"),
        Preset(
            "custom",
            "自定义(OpenAI 兼容接口)",
            "",
            "",
            "任何兼容 /chat/completions 的服务都可以(包括本地模型)",
        ),
    )
}


def provider_label(provider: str, model: str) -> str:
    if provider == "custom" or provider not in PRESETS:
        return f"自定义 · {model}"
    return f"{PRESETS[provider].name} · {model}"
