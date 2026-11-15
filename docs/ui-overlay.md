# 界面约定:对 private-style 基线的差异与实施细则

> M6「界面统一」(v1.2.0)之后,三个角色的界面按 private-style 视觉基线(中性色板、圆角 12 / 16、间距 4–32、无边框卡片、表头与数值同一边缘)统一。本文只记**本项目和基线不一样的地方**,以及实施中定下来、写代码时容易踩的约定。基线本身的文字在本机 skill 里(`.claude/skills/private-style/`,未入库),这里不重抄。
>
> 守卫:`apps/web/src/test/uiRules.test.ts`(扫描源码)、`e2e/layout-*.spec.ts`(量尺寸)。例外写进守卫的 `allow` 列表时,理由要和本文一致。

## 1. 与基线不同的八处

1. **家长端是手机优先**。底部固定页签栏,触控目标 44 px,内容容器 `max-w-2xl`(不是管理端、教师端的宽版容器)。详见第 4 节「家长端例外」。
2. **教室插画与投屏 / 全屏不受圆角和表面规则约束**。教室场景(`shared/components/ClassroomMap/**`)是自绘的 SVG,座位、讲台、黑板按教室的样子画;守卫和 e2e 都不扫它。
3. **中文系统字体栈**,不用 Geist / Inter。`tailwind.config` 的 `fontFamily.sans` 以苹方、鸿蒙黑体、MiSans 等系统中文字体开头:学校机器不一定能联网拉字体,中文字形也不能回退到西文字体。
4. **数字列对齐按 Q2**:量值列(分数、人数、百分比)**右对齐**,编号和文字列左对齐,表头和数据同一边缘。基线文字写的是「数字列左对齐」,与此不一致,以本项目为准:右对齐能让个位、十位上下对齐,93 和 100 一眼比出大小;编号不用比大小,和文本一样左对齐。
5. **教室页的侧栏默认 rail**(只显示图标),并且 < 1280 宽一律是抽屉,让舞台尽量宽。其他页面 ≥ 1280 默认展开,1024–1279 默认 rail,< 1024 是抽屉。
6. **下拉、复选框、开关用原生控件**(基线「有 Arc 优先 Arc」的例外)。原生 `<select>` 在平板上弹系统选择器,手感最好;换成自绘控件要重写大量既有测试。理由完整版见 M6 计划 §2.2。输入框边框保留(与 `Input` 同一约定)。
7. **数据语义的红绿保留**。分数涨跌、考勤出勤 / 缺勤、成绩状态色等表达数据含义的颜色不按「中性色板」去色;装饰性的彩色一律去掉。
8. **聊天发送按钮在消息为空时禁用**。基线要求表单「空提交就地报错」,聊天输入框是例外:空消息禁用发送比提示更干净。

## 2. 实施中定下的约定

### 2.1 令牌与阴影

- 深色主题 `--ws-card` 取 **11%**。计划原写 8%,与验收口径「卡片与页面的对比 ≥ 1.15」矛盾,实测 8% 达不到(裁定 G-T1)。
- 项目自己的 shadcn 变量带 `--ws-` 前缀,避免和 Arc 的全局变量同名;Arc 的模块样式在 `@layer arc`,工具类不分层,所以写在 `Button` / `Badge` 上的工具类总是生效。
- `cn`(`shared/lib/utils.ts`)认识自定义的 `shadow-surface` / `shadow-overlay`,用 `shadow-none` 可以正常覆盖;不要写 `shadow-[none]`。

### 2.2 页面骨架

- `PageContainer` 自带 `flex flex-col gap-6`;`PageHeader` 和各块内容作为它的**直接子节点**依次放,不要再加 `space-y-*` / `mb-*`。窄页 `width="narrow"` 的内容也必须是直接子节点,子节点自己的 `max-w-*` 会被压过。
- 页面标题统一用 `PageHeader`(守卫 `raw-h1` 禁止裸 `<h1>`)。加载分支如果也渲染 `PageHeader`,单测里 `findByRole('heading')` 会在数据到达前就返回,断言正文前先等一个只有正文才有的元素。

### 2.3 表格

- 量值列右对齐,编号和文字列左对齐(Q2)。
- 表比容器窄时传 `containerClassName="w-fit max-w-full"`,否则白色容器满宽、表头底色到一半截断。分页条和表格**包在同一个容器里右对齐**,不要把分页条放在容器外。
- 放在卡片里的表传 `containerClassName="bg-transparent shadow-none"`,不要在卡片里再套一圈框。
- `Td` / `Th` 默认**不换行**;备注、内容、原因这类长文本列要传 `nowrap={false}`(G-C4)。
- 行内可选的前置按钮(例如「展开」)要给没有按钮的行留**等宽占位**;包裹元素用块级 `flex`。行内 `inline-flex` 会因基线不同让文字上下错 2 px。
- 表格行、长列表里的按钮只用 `variant="link"` 或 `IconButton`,不用 `ghost` / `outline` / `default`。这几种走 Arc,每个按钮挂一个 `ResizeObserver`,文字变化时旧文字还会在 DOM 里留一会儿,单测取文本会拿到两份。

### 2.4 控件

- `SegmentedTabs` 的 `onChange` 写成 `(v) => setX(v)`,不要直接传 `setState`:直接传会让泛型回退成 `string`,`tsc` 报 TS2322(G-W2-2)。`size="sm"` 的页签按钮只有 24 高,过不了基线,用默认的 md。
- 不允许给 `<Button>` 写 `h-*`(守卫 `button-height`):要 44 高用 `size="touch"`,图标按钮用 `IconButton`。
- **触屏目标**:`touch-target` 类只在 `pointer: coarse` 下把最小尺寸撑到 44;鼠标下尺寸不变,桌面布局不受影响。侧栏的链接与按钮、抽屉的「打开菜单」按钮、回执表单按钮都挂它。
- `Switch` 的原生 input 盖在轨道上(不是 `sr-only`),Playwright 的 `check()` / `uncheck()` 可以直接点。

### 2.5 浮层

- `Menu` / `Popover` 用 `rounded-lg shadow-overlay`,**无边框**;`side` 支持 `top | bottom | right`。
- 浮层**不走 portal**,是纯 CSS 定位:放进带 `overflow` 的祖先(例如侧栏的导航区)会被裁掉(G-X-1)。需要从侧栏弹出的菜单,放在不裁剪的容器里,或像账号菜单那样挂在侧栏底部。
- `MenuItem` 目前不透传 `title` / `aria-describedby`,禁用原因只能并进菜单项名称(G-CR-1)。

### 2.6 图表

- `TrendLine` / `Sparkline` 有 `minPoints`(默认 1)和 `summary`:有效点数不足时显示「数据不足」而不是画一条线或空图(M17)。教师端的趋势图调用点要显式传 `minPoints`。

### 2.7 教室页

- 教室操作台按**容器宽度**进入紧凑形态,阈值 `DOCK_COMPACT_BELOW`(1040 px,见 `roles/teacher/Classroom/dockCompact.ts`),不看视口宽度:侧栏展开时舞台变窄,同一视口宽度下舞台宽度会变。紧凑形态里次要按钮收进「⋯」菜单,保持一行。

## 3. 家长端例外

守卫 `uiRules` 与 e2e 对家长端放过以下几处(G-P1-1、G-P1-2):

- 容器 `max-w-2xl`:手机阅读宽度,不用宽版容器。
- 768–1023 宽的导航条:`AppShell` 顶栏固定一行(`h-14`),放不下导航,现状是 `main` 顶部的 sticky 条(`ParentLayout.tsx` 里的临时方案)。≥ 1024 导航在顶栏,< 768 是底部页签栏。
- `ExamDetail` 保留原生 `<table>`:窄屏要卡片化,Table 组件不覆盖这种形态。
- 导航页签上的圆形未读计数徽标(`ParentNav`)命中 `pill-chip`,保留。

> 以上若有改动(例如 Z1 给 `AppShell` 加了第二行槽并删掉 sticky 条),以最终合并的代码为准,并回来改本节。

## 4. e2e 约定

- 新页面段的布局用例写成 `e2e/layout-<段>.spec.ts`,用 `e2e/helpers/layout.ts` 的 `expectBaselineLayout(page, { checkTitleX })`:标题只有一个、标题 x 与同角色一致、控件高度 ∈ {32, 40, 44, 48}、卡片无边框且圆角 ∈ {6, 12, 16}、无横向溢出、深色下卡片 / 表格容器与页面背景对比 ≥ 1.15。背景完全透明的表面不量,但页面上必须至少有一个有底色的卡片或表格容器。
- **先等真实内容再量**:骨架屏阶段尺寸不是最终的。先等一个只有正文才有的元素出现,再要求 `[aria-busy="true"]` 为 0;`getByText('加载中…')` 对骨架屏无效。
- **空数据页用 `page.route` 造数据**(`patchJson` 改 GET 响应),不要 `test.skip`:CI 种子库里很多页面是空状态,量不到卡片或表格。
- CI 种子库里监控开关默认关,摄像头接口返回 404;摄像头相关页面的用例要对接口直接 `fulfill`。
- e2e 辅助函数名不要以 `use` 开头(会触发 rules-of-hooks)。
- 单测:`CardTitle` 渲染 `div`,没有 heading 角色;`Card` 是 `div` 不是 `section`;testing-library 把所有 `<header>` 都算 `banner`(包括 `PageHeader`),取顶栏要排除 `[data-page-header]`。类名断言用 `classList`,不用会误中的子串(`min-w-28` 含 `w-28`)。

## 5. 依赖与密钥

- Arc 组件只经 `npx shadcn@latest add` 写入 `apps/web/src/shared/components/arc/`,不手改;页面只经 `shared/components/ui/*` 适配层用它(守卫 `arc-import-in-pages`)。
- `ARC_PRO_TOKEN` 只放 `apps/web/.env.local`,不进仓库、不进 CI 日志。
