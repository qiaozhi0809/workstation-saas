# 班级三角色协作平台(workstation-saas)

一个面向中小学的 **B 端 SaaS**(单校整体采购),基于"班主任工作台"的产品灵魂,扩展为 **三角色** 协作平台:

| 角色 | 定位 |
|---|---|
| **教师** | 班主任 / 副班主任 / 任课老师。继承原工作台的教室可视化、考勤、点评、随机点名、排座、成绩录入与分析、学生档案、AI 助手。 |
| **管理** | 校长 / 教导主任 / 年级组长 / 信息中心。看板、报表、组织架构、通知下发。 |
| **家长** | 主家长 / 次要家长。查看自己孩子的信息,接收通知,结构化回执。 |

此外,平台提供**监控画面接入**模块,把学校本地已有摄像头的实时画面桥接到 Web,按角色权限展示。

---

## 项目状态

🚧 **构建期** — M1(骨架 + 教师角色底座)与 M2a(教室交互)已完成:老师可登录,在自绘的教室场景里记考勤、点评、随机点名、排座,编辑黑板和个人偏好。M2b 成绩也已完成:成绩录入与分析、学生名单与导入导出、档案成绩页签与个人笔记、教室成绩模式与优带弱。M2c(AI 与学年)也已完成:老师可以用 AI 助手(14 个模板、自由对话、批量评语、复制提示词、导出 Word),档案抽屉有成长记录与评语页签,后端有学年升级的完整流程。下一步是 M3(管理角色)。

## 技术栈(锁定方向)

- **前端**:React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query
- **后端**:Python 3.12 + FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL 16 + Redis 7
- **部署**:v1 单校定制化,Docker Compose 一键起;私有化为主,数据不出校

详见 [`docs/superpowers/specs/2026-11-01-三角色协作平台-design.md`](docs/superpowers/specs/2026-11-01-三角色协作平台-design.md)。

---

## 目录结构

```
.
├── docs/
│   └── superpowers/
│       ├── specs/      # 设计文档(方向定稿)
│       └── plans/      # 分里程碑实施计划
├── reference-html/     # 原 HTML 项目(只读参考)
│   ├── index.html      # 原班主任工作台单文件
│   ├── ai-proxy.js     # 原 AI 代理
│   ├── screenshots/    # 原项目 UI 截图
│   └── features-extracted.md    # 原项目的功能考古报告(新项目内部 PRD)
├── server/             # Python 后端(M1 开始搭建)
├── apps/web/           # React 前端(M1 开始搭建)
└── deploy/             # 部署配置(Docker Compose 等)
```

> **原 HTML 项目的定位**:只做参考资料,代码一行不复用。新项目从零用 React + Python 实现,原 HTML 作为"产品说明书 + UI 原型"。

---

## 本地开发

### 环境要求

- Python 3.12 + [uv](https://docs.astral.sh/uv/)
- Node.js ≥ 20
- Docker(含 Compose v2),本地 Postgres / Redis 与后端测试都依赖它

首次拉取后安装依赖:

```bash
cd server && uv sync
cd apps/web && npm ci && npx playwright install chromium
```

### 启动顺序

在仓库根目录依次执行:

```bash
make dev        # 启动 Postgres 16(5432)和 Redis 7(6379)
make migrate    # 执行 Alembic 迁移
make seed       # 写入开发种子数据(重复执行会输出 already seeded)
make backend    # 后端 http://localhost:8080,接口都在 /api/v1 下
make web        # 前端 http://localhost:5173,/api 由 Vite 代理到 :8080
```

`make backend` 和 `make web` 各占一个终端。停止数据库用 `make dev-down`。

### 配置 AI

AI 服务由学校统一配置,API Key 加密后存在数据库里,不进任何文件。用命令行配置(Key 只从标准输入给):

```bash
cd server
printf '%s\n' "$YOUR_KEY" | uv run python -m app.cli ai-config set --provider deepseek --api-key-stdin
uv run python -m app.cli ai-config show    # 显示当前配置(Key 只露末 4 位)
uv run python -m app.cli ai-config test    # 测试连通性
uv run python -m app.cli ai-config clear   # 清除
```

`--provider` 可选 `deepseek`、`qwen`、`kimi`、`glm`、`doubao`、`silicon`、`custom`(任何 OpenAI 兼容地址,配 `--base-url` 和 `--model`)。`--mask-forced` 让学校强制隐去姓名:开启后,老师在页面上关掉"隐去姓名"也无效,而且已有对话的追问、批量条目和复制提示词也一律脱敏。

不想连真服务商时,本地开发和 E2E 用仓库里的假服务:`node apps/web/e2e/helpers/fakeLlm.mjs`(监听 18089),然后 `ai-config set --provider custom --base-url http://127.0.0.1:18089/v1 --model fake-model --api-key-stdin`(Key 随便给一个假值)。

**`WS_MASTER_KEY`**:加密 API Key 用的主密钥,32 字节的 base64(`openssl rand -base64 32`)。`WS_ENV` 不是 `dev` 时必须设置;它必须和数据库里的配置一起备份,主密钥丢了或换了,已存的 Key 就解不开,只能重新 `ai-config set`。开发环境用内置的固定值。

### 学年升级(命令行)

升级流程只有命令行(向导页面随 M3):

```bash
cd server
uv run python -m app.cli year-upgrade suggest --name 2027-2028 --start 2027-09-01 --end 2028-07-15 --out plan.json   # 按现有班级生成方案
uv run python -m app.cli year-upgrade preview plan.json     # 预览:每个班升到哪、留级、毕业、新建
uv run python -m app.cli year-upgrade apply plan.json --yes # 执行
uv run python -m app.cli year-upgrade rollback --yes        # 回滚最近一次(新学年已有数据时会拒绝,并列出数量)
```

升级会保留往年的考试、点评和成长记录(往年记录只读);原任课老师看不到旧班,新班主任能看到学生往年的成长记录但不能删。年级组长跟届走。

### 默认账号

| 登录名 | 密码 | 身份 |
|---|---|---|
| `teacher01` | `dev123` | 张老师,三年二班班主任 |
| `teacher02` | `dev123` | 王老师,三年二班副班主任 |
| `teacher03` | `dev123` | 赵老师,三年二班数学任课老师 |

种子数据被手工操作改乱后,用 `make reset-db` 回到初始状态(迁移降到底再升到最新,然后重新写入种子)。改过端口时同样在命令前带上 `WS_DATABASE_URL` / `WS_REDIS_URL`。

### 测试

```bash
make test                     # 后端 pytest(testcontainers 起真 Postgres / Redis)+ 前端 Vitest
cd server && uv run ruff check . && uv run ruff format --check .
cd apps/web && npm run lint && npx tsc -b
cd apps/web && npm run e2e    # Playwright:冒烟、教室、宽屏、成绩、学生、AI 助手、档案流程
```

`npm run e2e` 不会自己起服务,需要先按上面的启动顺序把数据库、后端和前端都跑起来;建议先 `make reset-db`。AI 配置存在数据库里,`reset-db` 会把它清掉:跑 E2E 前要先起假服务(`node apps/web/e2e/helpers/fakeLlm.mjs`),再用上面“配置 AI”一节的命令把 AI 配到假服务;`ai.spec.ts` 发现配置没指向 `fake-model` 会直接失败,不会把数据发给真服务商。用例会自己恢复改动过的数据(考勤点回出勤、点评撤销、座位存回种子布局;删掉 `E2E` 开头的考试、`测试` 开头的学生,清空王小一的个人笔记),可以重复跑。AI 与档案用例用 API 清掉自己建的对话、评语和成长记录。API 建考试会把预设科目写回 `classes.subjects`(种子里原本为空),不影响重复跑。

### 常见故障

- **testcontainers 报错连不上 Docker**:Docker 没有启动。先启动 Docker Desktop,再跑 `make test`。
- **`make dev` 报 5432 / 6379 端口被占用**:本机已有别的 Postgres / Redis。可以停掉它们;或者写一个不提交的 compose 覆盖文件改宿主机端口,例如:

  ```yaml
  # deploy/docker-compose.local.yml(不要提交)
  services:
    postgres:
      ports: !override ["15432:5432"]
    redis:
      ports: !override ["16379:6379"]
  ```

  用 `docker compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.local.yml up -d --wait` 启动,之后在命令前带上环境变量指向新端口:

  ```bash
  export WS_DATABASE_URL=postgresql+psycopg://workstation:workstation@localhost:15432/workstation
  export WS_REDIS_URL=redis://localhost:16379/0
  make migrate && make seed && make backend
  ```

  后端仍监听 8080,前端代理无需改动。
- **登录提示"失败次数过多,请 15 分钟后再试"**:同一账号连续 5 次密码错误会锁定 15 分钟。等锁定过期,或清空开发 Redis:`redis-cli FLUSHDB`(改过端口时加 `-p 16379`);本机没装 `redis-cli` 时用 `docker compose -f deploy/docker-compose.dev.yml exec redis redis-cli FLUSHDB`。

### M2c AI 与学年

| 功能 | 做什么 | 谁能用 |
|---|---|---|
| AI 助手(`/teacher/ai`) | 14 个模板(备课、作业、家长沟通、评语、家长会发言稿、成绩分析报告等)、自由对话、追问 / 停止 / 重新生成、复制提示词(给自己的 AI 工具用)、导出 Word | 有 `ai.use` 的老师;班主任模板需 `ai.class`,成绩分析报告需成绩读权限,不够的模板显示为禁用 |
| 批量评语 | 选多名学生逐条生成,可一键保存为评语 | 班主任 |
| 隐去姓名 | 姓名换成 `【学生07】` 这样的编号再发给服务商,回复里再换回真名;电话、证件号一律过滤;联系人不进提示词 | 默认开;学校强制时老师不能关 |
| 成长记录 | 档案抽屉里添加 / 删除成长记录,往年记录只读 | 班主任、副班主任可写;删别人写的记录需要班主任 |
| 评语 | 档案抽屉里的评语页签,可由 AI 生成后保存 | 班主任(副班主任和任课老师看不到评语页签内容) |
| 点评明细与撤销 | 档案成长记录页签里看前 40 条点评,撤销自己给的那条 | 给分人本人 |
| 分析页 AI 按钮 | AI 写分析报告、给退步同学家长写沟通消息 | 有对应模板权限的老师(成绩分析报告需成绩读权限,家长沟通需班主任) |

AI 的所有调用都经后端:脱敏、过滤、审计(每次生成一条 `ai.generate`,不记内容)都在服务端做;前端拿到的永远是真名文本。

### M2a 教室交互

教师端教室页(`/teacher/classroom`)底部的模式条切换四种模式,底部操作台跟随模式变化,待办与最近点评在操作台最右端的"待办与点评"抽屉里:

| 模式 / 功能 | 做什么 | 谁能用 |
|---|---|---|
| 日常 | 教室场景、悬停卡(学号 / 职务 / 今日考勤 / 本周积分)、点学生打开档案、空闲小动画 | 所有能看本班的老师 |
| 考勤 | 点学生轮转 请假 → 缺勤 → 迟到 → 出勤;确认考勤、全部出勤、按月导出 CSV;日期以学校时区为准 | 班主任、副班主任写;任课老师只读 |
| 点评 | 点学生选理由加减分(8 秒内可撤销)、全班 +1、积分榜、导出点评 | 班主任、副班主任、任课老师(任课老师记入任教科目) |
| 排座 | 点选或拖拽交换、随机打乱、男女同桌、固定座位、改排列数、打印;两人同时改时后保存者收到冲突提示 | 仅班主任 |
| 随机点名 | 跳过今天请假 / 缺勤的同学,"回答得好 +1" | 日常模式的操作台上直接显示,考勤 / 点评模式在"更多操作"里 |
| 黑板 / 全屏 / 缩放 | 编辑左右黑板和倒计时;全屏投屏(日常 / 点评模式下不投出考勤标签);缩放、平移 | 黑板仅班主任 |

右上角头像菜单("账号菜单")里的"我的偏好"可以选老师形象、开关空闲小动画、维护点评理由;学生档案"概览"页可以设置职务(仅班主任)。

### M2b 成绩

顶栏的“成绩”“学生”两个入口,加上学生档案和教室页的成绩模式:

| 功能 | 做什么 | 谁能用 |
|---|---|---|
| 成绩页(`/teacher/scores`) | 建 / 改 / 删考试;表格录入(键盘、Excel 粘贴、按表头导入),自动保存;总分与排名;导出成绩 | 班主任全部科目、可导出;任课老师只录、只看本科目,可建只含本科目的考试并改 / 删自己建的(含其他科目的考试删不了),不能导出 |
| 分析页(`/teacher/analysis`) | 平均分 / 及格率 / 优秀率等 KPI、成绩分布与趋势图表、排名与关注名单 | 班主任全部科目;任课老师只有本科目的指标和排名;校长等管理角色后端已有只读 + 导出权限,页面在 M3 |
| 学生页(`/teacher/students`) | 名单表格、添加 / 编辑 / 删除(含座位、联系人、住校)、批量导入、导出名单 | 班主任;任课老师只看名单,不能增删改和导出 |
| 学生档案 | 抽屉里的概览(含累计积分、本月考勤、生日)、成绩页签(排名曲线、学科雷达)、班主任个人笔记 | 能看本班的老师都能开档案,字段按权限显示(任课老师看不到家庭信息,副班主任只看基本信息,看不到学习情况、性格等);成绩页签需有成绩读权限;个人笔记仅班主任本人 |
| 教室成绩模式 | 选考试,桌面按名次着色、进退步角标、无成绩变暗、色阶图例;投屏时不着色、不显示角标和图例 | 有成绩读权限的老师(任课老师按本科目排名) |
| 优带弱排座 | 按最近一场考试名次首尾配对、打乱桌序,尊重固定座位 | 仅班主任(排座权限) |
| 最近考试 | “待办与点评”抽屉里的最近考试、平均分与历次平均得分率曲线 | 有成绩读权限的老师 |

开发环境下 `/dev/classroom` 是教室画面的调试页:不连后端,用示例数据调排列数、模式、投屏、学生姿态和老师动作,方便看画面。

---

## 开发路线

| 里程碑 | 关键交付 |
|---|---|
| M0 考古 ✅ | features-extracted.md + 项目骨架准备 |
| M1 骨架 + 教师角色底座 ✅ 已完成 | 老师可登录、看教室(静态)、看学生档案 |
| M2a 教室交互 ✅ 已完成 | 考勤、点评、随机点名、排座、黑板、空闲小动画、全屏投屏、我的偏好 |
| M2b 成绩 ✅ 已完成 | 成绩录入与分析、学生名单与导入导出、档案成绩页签与个人笔记、教室成绩模式与优带弱 |
| M2c AI 与学年升级 ✅ 已完成 | AI Gateway(脱敏、审计、流式)、14 个模板与批量评语、成长记录与评语页签、点评撤销、学年升级(后端 + 命令行) |
| M3 管理角色 | 校长看板 + 报表 + 账号管理 + 通知下发 |
| M4 家长角色 | 响应式 Web,家长看自己孩子 |
| M5 监控 + 部署 | 视频流接入 + Docker Compose 一键部署 |

节奏按团队实际投入和客户反馈调整,**不作绝对时间承诺**。

---

## 文档

- 🤖 [AI 代理工作指南(AGENTS.md)](AGENTS.md) — **AI 代理 / 开发者先读这个**
- [三角色协作平台设计文档](docs/superpowers/specs/2026-11-01-三角色协作平台-design.md)
- [总体路线图与计划审查](docs/superpowers/plans/2026-11-01-总体路线图与计划审查.md)
- [M1 实施计划 · 骨架与教师角色底座](docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md)
- [M2a 实施计划 · 教室交互](docs/superpowers/plans/2026-11-01-M2a-教室交互.md)([范围清单](docs/superpowers/plans/2026-11-01-M2a-范围清单.md))
- [M2b 实施计划 · 成绩](docs/superpowers/plans/2026-11-02-M2b-成绩.md)([范围清单](docs/superpowers/plans/2026-11-02-M2b-范围清单.md))
- [原 HTML 项目功能考古](reference-html/features-extracted.md)

---

## 许可

**专有(proprietary)**,保留所有权利。本仓库为私有仓库,非经授权不得公开、分发或商用。

原 HTML 项目(`reference-html/` 下的 `index.html`、`ai-proxy.js`、`screenshots/`)**来自同一作者**,仅作为新项目的参考资料存在。
