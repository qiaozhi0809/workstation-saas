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

🚧 **构建期** — 已完成设计定稿与 M1 实施计划,代码即将开写。

## 技术栈(锁定方向)

- **前端**:React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query
- **后端**:Go + Gin + sqlc + PostgreSQL 16 + Redis 7
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
├── server/             # Go 后端(M1 开始搭建)
├── apps/web/           # React 前端(M1 开始搭建)
└── deploy/             # 部署配置(Docker Compose 等)
```

> **原 HTML 项目的定位**:只做参考资料,代码一行不复用。新项目从零用 React + Go 实现,原 HTML 作为"产品说明书 + UI 原型"。

---

## 开发路线

| 里程碑 | 关键交付 |
|---|---|
| M0 考古 ✅ | features-extracted.md + 项目骨架准备 |
| **M1 骨架 + 教师角色底座** 🔜 | 老师可登录、看教室(静态)、看学生档案 |
| M2 教师角色核心功能 | 考勤 / 点评 / 随机点名 / 排座 / 成绩 / AI 助手 |
| M3 管理角色 | 校长看板 + 报表 + 账号管理 + 通知下发 |
| M4 家长角色 | 响应式 Web,家长看自己孩子 |
| M5 监控 + 部署 | 视频流接入 + Docker Compose 一键部署 |

节奏按团队实际投入和客户反馈调整,**不作绝对时间承诺**。

---

## 文档

- [三角色协作平台设计文档](docs/superpowers/specs/2026-11-01-三角色协作平台-design.md)
- [M1 实施计划 · 骨架与教师角色底座](docs/superpowers/plans/2026-11-01-M1-骨架与教师角色底座.md)
- [原 HTML 项目功能考古](reference-html/features-extracted.md)

---

## 许可

**专有(proprietary)**,保留所有权利。本仓库为私有仓库,非经授权不得公开、分发或商用。

原 HTML 项目(`reference-html/` 下的 `index.html`、`ai-proxy.js`、`screenshots/`)**来自同一作者**,仅作为新项目的参考资料存在。
