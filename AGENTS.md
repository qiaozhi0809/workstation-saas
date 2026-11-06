# AGENTS.md — AI 代理工作指南

> **如果你是一个 AI 代理**(Claude Code / Cursor / GPT / Gemini / Copilot / ...)被派来在这个仓库里工作,**先读完本文件**,再动手。

---

## 1. 这是什么项目

**班级三角色协作平台**(workstation-saas),一个面向中小学的 **B 端 SaaS**(单校整体采购)。

- **三角色**:教师 / 管理 / 家长 — 共享一个 Web 应用的三种视图(**不是三个独立前端项目**)
- **技术栈**:前端 React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query;后端 Python 3.12 + FastAPI + SQLAlchemy 2(同步)+ Alembic + PostgreSQL 16 + Redis 7
- **部署**:v1 单校定制化,Docker Compose 一键起,数据不出校

---

## 2. 读文件的顺序(严格按此)

| # | 文件 | 读什么 |
|---|---|---|
| 1 | [`README.md`](README.md) | 项目做什么、目录结构 |
| 2 | [`docs/superpowers/specs/2026-11-01-三角色协作平台-design.md`](docs/superpowers/specs/2026-11-01-三角色协作平台-design.md) | **设计文档(方向定稿)** — 全部设计决策的权威。**不要擅改**,偏离必须征得用户同意 |
| 3 | [`docs/superpowers/plans/2026-11-01-总体路线图与计划审查.md`](docs/superpowers/plans/2026-11-01-总体路线图与计划审查.md) | 里程碑路线、待决事项、spec 能力归属 |
| [`docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md`](docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md) | **M1 实施计划** — 你要执行的任务清单,共 17 个 task,全部 TDD 粒度 |
| 4 | [`reference-html/features-extracted.md`](reference-html/features-extracted.md) | 原 HTML 项目的功能考古报告 — 新项目的**内部 PRD**。遇到"原版这个功能怎么做的"查这里 |
| 5 | [`reference-html/index.html`](reference-html/index.html) | 原始 HTML(只读参考) — 功能考古写不清楚的,去这里查原文 |

---

## 3. 核心约束(违反必定被 reject)

### 产品/设计

- **代码不复用原 HTML**。只参考它的产品设计。所有 React 组件、业务逻辑、SVG 渲染都是从零写的。
- **三角色 = 共享一个 Web 应用的三种视图**。不是三个独立前端。
- **家长端 v1 不接触监控视频**(合规底线)
- **教师只看自己负责的班级**(RBAC 规则)
- **监控 v1 仅视频流接入,无 AI 事件识别**(明确砍掉)
- **AI 调用走后端 Gateway**(脱敏 + 审计)
- **原项目 non-commercial license** 和新项目 proprietary license 分离,代码别交叉复制

### 工程

- **TDD**:先写失败测试 → 跑测试 → 实现 → 跑测试通过 → commit。每个 task 结束至少一次 commit。
- **不写估时**。不作绝对时间承诺(spec 里已经清掉工期)。
- **不写占位符**(TBD / TODO / "后续补")。每个代码块必须是**可直接复制粘贴可运行**的代码。
- **不写不必要的抽象**。YAGNI。
- **不写不必要的错误处理**。只在系统边界(用户输入、外部 API)validate。
- **commits** 用 Conventional Commits 格式:`feat:` / `fix:` / `chore:` / `test:` / `docs:` / `refactor:`
- **分支**:`main` 为主分支;功能开发在 feature 分支(可选)。首次实现可直接推 main。
- **迁移预检**:新迁移里每个 `CHECK` / 唯一约束 / `NOT NULL`(对已有表加的)必须在 `server/app/deploy/precheck.py` 的 `CHECKS` 登记预检,否则升级旧库时会在迁移中途失败;`tests/test_precheck.py` 会扫描迁移 SQL 核对。新迁移还必须加入 `server/app/deploy/precheck.py` 的 `REVIEWED_REVISIONS` 签收集合(M5d 起,段 A2 落地;台账 L113)——扫描器对 FK / `ADD COLUMN` / `DO` 块有盲区,签收表示人工核对过。

### 安全

- **不要 commit 真实密钥**。seed 文件里的 `dev-secret-change-me` / `CHANGE_ME_32_BYTES_MIN` 这类占位符保留原样。
- **不要在 commit 消息里暴露用户私密信息**(真实姓名、电话等)。
- **git author 用 GitHub noreply 邮箱**:`135817592+qiaozhi0809@users.noreply.github.com`。

---

## 4. 当前进度与任务

| 里程碑 | 状态 | 产出 |
|---|---|---|
| **M0 考古** | ✅ 已完成 | [`reference-html/features-extracted.md`](reference-html/features-extracted.md)(1771 行,PRD 级) |
| **M1 骨架 + 教师角色底座** | ✅ 已完成(`v0.1.0-m1-foundation`) | 17 task,文件:[`docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md`](docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md) |
| **M2a 教室交互** | ✅ 已完成(`v0.2.0-m2a-classroom`) | 23 task,文件:[`docs/superpowers/plans/2026-11-01-M2a-教室交互.md`](docs/superpowers/plans/2026-11-01-M2a-教室交互.md) |
| **M2a.5 UI 基础与打磨** | ✅ 已完成(`v0.2.5-m2a5-ui`) | 17 task,文件:[`docs/superpowers/plans/2026-11-01-M2a5-UI基础与打磨.md`](docs/superpowers/plans/2026-11-01-M2a5-UI基础与打磨.md) |
| **M2a.6 宽屏教室与操作台** | ✅ 已完成(`v0.2.6-wide-classroom`) | 10 task,文件:[`docs/superpowers/plans/2026-11-02-宽屏教室与操作台.md`](docs/superpowers/plans/2026-11-02-宽屏教室与操作台.md) |
| M2b 成绩 | ✅ 已完成(tag `v0.3.0-m2b-grades`,合并后由协调会话打) | 21 task,文件:[`docs/superpowers/plans/2026-11-02-M2b-成绩.md`](docs/superpowers/plans/2026-11-02-M2b-成绩.md)、[范围清单](docs/superpowers/plans/2026-11-02-M2b-范围清单.md) |
| M2c AI 与学年 | ✅ 已完成(tag `v0.4.0-m2c-ai-year`,合并后由协调会话打) | 24 task,文件:[`docs/superpowers/plans/2026-11-02-M2c-AI与学年.md`](docs/superpowers/plans/2026-11-02-M2c-AI与学年.md)、[范围清单](docs/superpowers/plans/2026-11-02-M2c-范围清单.md) |
| M2d 桌椅排列 | ✅ 已完成(tag `v0.4.5-m2d-desks`) | 12 task,文件:[`docs/superpowers/plans/2026-11-03-M2d-桌椅排列.md`](docs/superpowers/plans/2026-11-03-M2d-桌椅排列.md)、[范围清单](docs/superpowers/plans/2026-11-03-M2d-范围清单.md) |
| M3a 管理底座与看全校 | ✅ 已完成(tag `v0.5.0-m3a-admin-org`,合并后由协调会话打) | 18 task,管理端壳、组织架构、账号、学校设置、今日关注、全校看板;文件:[M3a 计划](docs/superpowers/plans/2026-11-03-M3a-管理底座与看全校.md) |
| M3b 联考报表、通知与学年 | ✅ 已完成(tag `v0.5.1-m3b-reports-notify`,合并后由协调会话打) | 18 task(1–18):年级联考与成绩汇总、月度考勤报告、审计查询、AI 使用与配置、通知与 WebSocket 实时推送、学年升级向导、往年班级只读查看;文件:[M3b 计划](docs/superpowers/plans/2026-11-03-M3b-联考报表通知与学年.md);M3 整体范围:[范围清单](docs/superpowers/plans/2026-11-03-M3-范围清单.md) |
| M4a 家长账号与看孩子 | ✅ 已完成(tag `v0.6.0-m4a-parent-view`,合并后由协调会话打) | 11 task:班主任建家长账号(登录名 = 手机号)、家长手机端今日 / 成长 / 成绩 / 档案、迷你教室、评语给家长看、毕业后只读 365 天再归档、台账 L12 前半 / L32 / L50;文件:[M4a 计划](docs/superpowers/plans/2026-11-04-M4a-家长账号与看孩子.md) |
| M4b 通知到家长与回执 | ✅ 已完成(tag `v0.6.1-m4b-parent-notify`,合并后由协调会话打) | 8 task:班级公告、管理端发家长、结构化回执与统计导出、家长端通知页签与实时推送、家长绑定口径(L62 / L67 / L75)、E2E 与走查;文件:[M4b 计划](docs/superpowers/plans/2026-11-04-M4b-通知到家长与回执.md);M4 整体范围:[范围清单](docs/superpowers/plans/2026-11-04-M4-范围清单.md) |
| M5 监控 + 部署 = v1 发布 | ⏳ M5a ✅ 已完成(tag `v0.7.0-m5a-deploy`,合并后由协调会话打;离线包 + 四个脚本 + 诊断包 + 定时任务 + D13 评估,本机 Mac(arm64,`--force`)按 `deploy/README.md` 验收;x86_64 Ubuntu 与 systemd 定时器的真机验收见台账 L125),M5b ✅ 已完成(tag `v0.7.1-m5b-security`,合并后由协调会话打;可选两步验证 TOTP、登录日志与异常登录提醒、密码长度与有效期可配、改 / 重置密码即下线、多标签页同步、账号与家长绑定遗留、加密附加数据;本机 Mac 从 `init-school` 空库 `upgrade.sh` 升级与 `restore.sh` 降级验收通过),M5c ✅ 已完成(tag `v0.7.2-m5c-cameras`,合并后由协调会话打;PR #98–#107:作息与课表、摄像头管理(加密凭据、内网校验、测试连接带编码探测)、`stream-worker` RTSP→HLS(资源限额、停更看门狗、H.265 提示)、`CameraStrip` / `CameraWallMini`、假摄像头 E2E 与 CI 真流;升级验收与性能实测改为 CI 冒烟 + 用户真机,见台账 L176 / L202),M5d 进行中(第 1 波已开工) | 拆四段串行:[M5a 部署与运维](docs/superpowers/plans/2026-11-05-M5a-部署与运维.md)(`v0.7.0-m5a-deploy`,12 task)→ [M5b 账号安全](docs/superpowers/plans/2026-11-05-M5b-账号安全.md)(`v0.7.1-m5b-security`,10 task)→ [M5c 监控与课表](docs/superpowers/plans/2026-11-05-M5c-监控与课表.md)(`v0.7.2-m5c-cameras`,10 task)→ [M5d 学校设置、引导与打磨](docs/superpowers/plans/2026-11-05-M5d-学校设置引导与打磨.md)(`v1.0.0-rc.1`,12 task;用户验收后打 `v1.0.0`);M5 整体范围与台账对账:[范围清单](docs/superpowers/plans/2026-11-05-M5-范围清单.md) |

---

## 5. 怎么执行 M1 plan

### 5.1 整体节奏

17 个 task,从 Task 1 开始,按顺序执行(段 B 与 Task 10–12 可并行,见 plan 的 Task 概览)。每个 task 内部按 Step 顺序走,每个 Step 粒度在 2-5 分钟:

```
Step N: Write failing test   → 写测试代码
Step N+1: Run test (expect FAIL) → 跑测试,看到 FAIL
Step N+2: Implement           → 写实现代码
Step N+3: Run test (expect PASS) → 跑测试,看到 PASS
Step N+(1-k): Commit          → git add && git commit
```

### 5.2 执行方式(两种选项,看你的 context 预算)

#### 选项 A:子代理驱动(**推荐**)
- 每个 task 派一个新 subagent 实现(fresh context)
- 完成后派一个 reviewer subagent 独立 review(也是 fresh context)
- Review 通过才进入下一个 task
- 全部完成后,最后一次整支分支 review
- **成本更高(每 task 两次 fresh context)但一次性做对的概率最大**

#### 选项 B:主代理单线执行
- 由主代理按顺序实现全部 17 个 task
- 最后派一个 reviewer 整体 review
- **成本最低,但中间无独立质量门,主代理 context 可能爆**

#### 推荐决策
- **M1 建议走选项 A**:涉及教室可视化(易错)和权限边界(易错),一次性做对的价值高。
- **M2-M5 可以视情况降级为选项 B**。

### 5.3 完成 M1 的 Done 标准

- [ ] 全部 17 个 task 的测试都通过
- [ ] Task 17 的 E2E 冒烟测试通过(login → classroom → student profile)
- [ ] [`README.md`](README.md) 里的本地启动文档被实际跑通
- [ ] git log 清晰,commit 消息符合 Conventional Commits
- [ ] 打 tag `v0.1.0-m1-foundation` 并 push 到 origin

---

## 6. 什么时候必须暂停找人类用户介入

**代理不要擅自决定**的事情:

- 偏离 spec 的设计决策(如改技术栈、改架构、添/删大模块)
- 新增 ≥ 1 个大型依赖(例如:从 TanStack Query 换成 SWR)
- 需要真实凭据(API key、数据库账号、生产密钥)
- 任何触及 `main` 分支强推/删 branch 的破坏性 git 操作
- Spec 里标注"开放问题 / 未定事项"(§10.1)的内容
- 用户要求你做的事情和本文件/spec/plan 矛盾时

**遇到以上,停下来,把问题讲清楚,等用户答复**。

### 缺口台账维护

- 段会话 PR 的"已知缺口"、协调会话收尾总结里的遗留问题,都要登进[遗留缺口台账](docs/superpowers/plans/2026-11-03-遗留缺口台账.md),并写明归属(里程碑 / task)。
- 写新计划前,要对整份台账对账,不只看上一个里程碑。

---

## 7. 技术栈具体版本

| 维度 | 版本 |
|---|---|
| Python | 3.12(`>=3.12,<3.13`,用 uv 管理) |
| Node | ≥ 20 |
| PostgreSQL | 16 |
| Redis | 7 |
| React | 18 |
| TypeScript | 5 |
| Vite | 5 |
| Tailwind | 3 |
| shadcn CLI | 2.3.0(最后支持 Tailwind 3) |
| tailwind-merge | 2.x(3.x 只支持 Tailwind 4) |
| Docker Compose | v2 |

**不要擅自升级这些版本**。版本升级要征求用户同意。

---

## 8. 测试与验证

| 层 | 工具 | 命令 |
|---|---|---|
| 后端单元/集成 | pytest + testcontainers(真 Postgres / 真 Redis) | `cd server && uv run pytest` |
| 前端单元 | Vitest + Testing Library | `cd apps/web && npm run test`;只跑一部分并限制并发时写 `npx vitest run <目录> --maxWorkers=2 --minWorkers=1`(本机 vitest 2.1.9 只给 `--maxWorkers` 会报 minThreads 冲突) |
| 前端 E2E | Playwright(project 链 mutating → … → admin → m3b → m4a → m4b → m5b → m5c → readonly;`m5c` 用系统 Chrome(`channel: 'chrome'`,Playwright 自带的 Chromium 不解 H.264),需先起下一行的假摄像头与 `python -m app.stream`) | `cd apps/web && npm run e2e` |
| 假摄像头 / 真流测试 | mediamtx + ffmpeg 推流(`cam1` H.264、`cam2` H.265)+ pytest `ffmpeg` / `perf` 标记 | `docker compose -f deploy/docker-compose.dev.yml --profile camera up -d` → `cd server && uv run pytest -m "ffmpeg and not perf" -q`(本机需装 ffmpeg / ffprobe,缺了或假摄像头连不上时自动 skip);性能冒烟 `uv run pytest -m perf -q -s`(3 路 copy + 1 路转码 30 秒,只在 CI e2e job 单独一步跑,结果上传 `stream-perf` 产物) |
| 后端 Lint | ruff | `uv run ruff check . && uv run ruff format --check .` |
| 前端 Lint | ESLint + Prettier | `npm run lint` |
| 部署镜像 | Docker | `make image VERSION=<标签>`(构建 `workstation-app`、`workstation-web`、`workstation-stream` 三个镜像;`workstation-stream` 基于同标签的 `workstation-app` 加 ffmpeg) |
| 部署脚本测试 | bash + Docker | `bash deploy/tests/compose_smoke.sh`、`install_fresh.sh`、`install_twice.sh`、`upgrade_same.sh`、`upgrade_precheck_fail.sh`、`backup_restore.sh`、`restore_rejects.sh`(都在 `deploy/tests/`,CI `deploy` job 逐个跑);升级路径两个较慢的脚本放单独的 CI `deploy-upgrade-path` job:`upgrade_rollback.sh`(升级失败后 `rollback.sh` 回退、`kill -9` 中断后的提示与回退)、`upgrade_from_previous.sh`(用上一个发布 tag 打出的旧离线包装一套再用本提交的包升级,需 `WS_PREVIOUS_DEPLOY_SRC` / `WS_PREVIOUS_VERSION`,tag 不存在时只告警) |
| 部署脚本 Lint | shellcheck | `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.9.0 -S warning -x deploy/prod/scripts/*.sh deploy/tests/*.sh deploy/release/*.sh`(该镜像的入口已是 shellcheck,不要再写一次 `shellcheck`;CI 用 runner 自带的 shellcheck,版本未钉,见台账 L123) |

部署测试脚本须以**非 root** 用户运行,且该用户在 `docker` 组里;**逐个跑**,不要并行(它们共用 compose 项目名 `ws-m5a-b`、端口 18080 / 18443 与固定子网 `172.30.0.0/24`,可用 `WS_TEST_PROJECT`(`compose_smoke.sh` 另兼容旧名 `WS_SMOKE_PROJECT`)、`WS_HTTP_PORT`、`WS_HTTPS_PORT`、`WS_TEST_VERSION`(旧名 `WS_VERSION` 仍有效)、`WS_TEST_DEPLOY_SRC`(被测部署目录,默认 `deploy/prod`)覆盖);镜像须先用 `make image VERSION=0.0.0-seg-b`(或 `WS_VERSION` 指定的标签)构建好。

**不要 mock 数据库和 Redis**。用 testcontainers 跑真服务(plan Task 3 提供 conftest);本机需先启动 Docker。

---

## 9. 关键设计决策速查(**不要擅改**)

| 决策 | 为什么 | 文档位置 |
|---|---|---|
| B 端学校整体采购,单校定制化 v1 | 商业模式确定 | spec §0.1 |
| 三角色 = 三视图(非三前端) | 单 Web 应用更一致 | spec §2 |
| React + Python(FastAPI) | 用户选定(D12 取代原 D04 的 Go) | spec §1.2 |
| SQLAlchemy 同步 + Alembic | 简单可测,单校并发足够 | spec §1.2 |
| 源码保护推迟到 M5 | Docker 本身不保护源码,部署时再定方案 | spec D13 |
| 抛弃原 HTML 代码,只借鉴设计 | 用户决定 | spec §4.1 |
| 原项目 features-extracted.md 作为 PRD | M0 考古产出 | reference-html/ |
| 监控 v1 只做视频流接入,砍掉 AI 事件 | 用户明确砍 | spec §5 |
| 家长 v1 不看监控 | 合规 + 政策 + 老师关系 | spec §5.5 |
| 教师只看自己班 | 老师关系最小权限 | spec §2.3 |
| AI 调用走后端 Gateway | 脱敏 + 审计 | spec §6.2 |
| v1 单租户,v2 再多租户 | 复杂度管理 | spec §0.2 |
| 永久脱敏编号 `s.mk` | AI 对话里稳定对应 | reference-html PRD §1 |

完整决策历史见 spec 附录 A(13 条)。

---

## 10. 一句话 TLDR

**读完 spec + M1 plan + features-extracted.md 的相关章节,然后按 M1 plan 的 Task 1 开始 TDD,每个 task 独立 commit。遇到不确定的,先问人类用户。不要擅改设计决策。**

---

**问候下一个代理** 🤖:plan 写得很细,照着做就行。重点看 Review Focus 的 5 条测试落点,那是最容易被忽略的用户真实场景。祝好。
