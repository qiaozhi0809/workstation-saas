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

🚧 **构建期** — M1(骨架 + 教师角色底座)已完成:老师可登录、看自己班的静态教室、打开学生档案。下一步是 M2 教师核心功能。

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

### 默认账号

| 登录名 | 密码 | 身份 |
|---|---|---|
| `teacher01` | `dev123` | 张老师,三年二班班主任 |

### 测试

```bash
make test                     # 后端 pytest(testcontainers 起真 Postgres / Redis)+ 前端 Vitest
cd server && uv run ruff check . && uv run ruff format --check .
cd apps/web && npm run lint && npx tsc -b
cd apps/web && npm run e2e    # Playwright 冒烟:登录 → 教室 → 学生档案
```

`npm run e2e` 不会自己起服务,需要先按上面的启动顺序把数据库、后端和前端都跑起来。

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

---

## 开发路线

| 里程碑 | 关键交付 |
|---|---|
| M0 考古 ✅ | features-extracted.md + 项目骨架准备 |
| M1 骨架 + 教师角色底座 ✅ 已完成 | 老师可登录、看教室(静态)、看学生档案 |
| M2 教师角色核心功能 | 拆为 M2a 教室交互 / M2b 成绩 / M2c AI 与学年升级 |
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
- [原 HTML 项目功能考古](reference-html/features-extracted.md)

---

## 许可

**专有(proprietary)**,保留所有权利。本仓库为私有仓库,非经授权不得公开、分发或商用。

原 HTML 项目(`reference-html/` 下的 `index.html`、`ai-proxy.js`、`screenshots/`)**来自同一作者**,仅作为新项目的参考资料存在。
