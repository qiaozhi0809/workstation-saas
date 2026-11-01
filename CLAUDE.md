# CLAUDE.md

> Claude Code / Claude 相关代理:**先读 [`AGENTS.md`](AGENTS.md)**。
> 本文件只是让 Claude Code 自动发现 AGENTS.md 的入口。

AGENTS.md 覆盖:
- 项目是什么
- 读文件的顺序
- 核心约束(TDD / 不写估时 / 不写占位符 / 不改设计决策)
- 当前进度与 M1 任务
- 两种执行方式(subagent-driven vs native)
- 什么时候必须暂停找用户
- 技术栈版本锁定
- 测试与验证命令
- 关键设计决策速查

---

### Claude Code 特有建议

- 优先使用 `superpowers:subagent-driven-development` 技能来执行 M1 plan(plan 顶部已经写了)。
- 执行 plan 时使用 `superpowers:executing-plans` 的流程。
- 遇到不确定的产品决策时,使用 `AskUserQuestion` 快速确认。
- 本项目 git author 用:`乔稚 <135817592+qiaozhi0809@users.noreply.github.com>`(已设在本地 git config)。
