# 原版基线记录

本目录是原项目 **workstation-teacher**(班主任工作台,单文件 HTML)的只读参考。新项目只参考它的产品设计,不复用代码(见 [`AGENTS.md`](../AGENTS.md) §3)。

## 当前基线

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/cyberdaddyleo/workstation-teacher |
| 基线版本 | **v1.0.0**(`index.html` 内 `VERSION = '1.0.0'`) |
| 基线提交 | `0bcff76`(2026-10-29,"Release 班主任工作台 v1.0") |
| 本目录的 `index.html` | 与上游 `0bcff76:index.html` **逐字节相同**(2026-11-03 用 `cmp` 核对) |
| 本目录的 `ai-proxy.js` | 与上游同一提交相同;v1.1.0 未改动 |
| 功能考古 | [`features-extracted.md`](features-extracted.md) 正文对应本基线 |

## 已知的上游后续版本

| 版本 | 提交 | 日期 | 内容 | 接入情况 |
|---|---|---|---|---|
| v1.1.0 | `a49bd54` | 2026-11-02 | 班级设置 · 桌椅排列(每桌人数、按人数自动排、讲台两边的单人桌、学号顺序入座、教室名称);排座与打印随之调整;关于页开发者信息 | 作为 **M2d** 接入:[范围清单](../docs/superpowers/plans/2026-11-03-M2d-范围清单.md) / [实施计划](../docs/superpowers/plans/2026-11-03-M2d-桌椅排列.md);功能摘要见 [`features-extracted.md` 附录 D](features-extracted.md)。开发者信息不跟 |

本目录的 `index.html` **保持 v1.0.0 不变**;v1.1 的行为以附录 D 和 M2d 范围清单为准。

## 上游再更新时怎么比对

1. 把上游 clone 到仓库**之外**的空目录(只读、不运行):`git clone https://github.com/cyberdaddyleo/workstation-teacher <临时目录>`。
2. 确认基线没变:`git -C <临时目录> show 0bcff76:index.html | cmp - reference-html/index.html` 无输出。
3. 列出基线之后的提交:`git -C <临时目录> log --oneline 0bcff76..HEAD`;已接入的版本见上表。
4. 逐项看改动:`git -C <临时目录> diff <上一个已登记的提交> <新提交> -- index.html ai-proxy.js`,对照 `features-extracted.md` 判断每项是新功能、已有功能改动、bug 修复还是无关(署名、文档)。
5. 写调研结论(改动分类、建议归属、需要拍板的事),用户定范围后再写范围清单与计划;在上表追加一行,写明接入的里程碑。
6. 不要把上游新版的 `index.html` 覆盖进本目录,也不要把上游代码复制进新项目。
