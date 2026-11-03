班级三角色协作平台的前端单页应用(React + Vite),开发方式见仓库根目录 README。

## UI 约定

颜色一律用语义令牌(定义在 `src/theme/index.css`,映射在 `tailwind.config.ts`),不写原始色板(`bg-blue-500`)、`white` / `black` 或十六进制类。这条由 `src/theme/noLegacyStyles.test.ts` 对 `src` 下所有非测试的 TS/TSX 文件强制检查;深色模式随令牌自动切换。

| 令牌 | 用途 |
|---|---|
| `background` / `foreground` | 页面底色 / 正文 |
| `card` / `popover` | 卡片 / 弹出层表面 |
| `primary` / `secondary` | 主操作 / 次要操作 |
| `muted` / `muted-foreground` | 弱化底色 / 次要文字 |
| `accent` | 悬停、选中底色 |
| `border` / `input` / `ring` | 边框 / 输入框边框 / 焦点环 |
| `destructive` | 危险、缺勤、扣分 |
| `success` | 正向:出勤、加分 |
| `warning` | 提醒:请假 |
| `info` | 提示:迟到 |

色调映射集中在 `src/shared/lib/tone.ts`:出勤 present→success、leave→warning、absent→danger(`destructive`)、late→info;加分 success、扣分 destructive。

### 可用组件

- `src/shared/components/ui/`:shadcn 生成的 `button`、`input`、`textarea`、`label`、`card`、`badge`、`separator`、`dialog`、`sheet`;项目自写的 `native-select`(`NativeSelect`)、`segmented-tabs`(`SegmentedTabs`)。
- `overlay/`:`Modal`、`SidePanel`;`Popover`(非模态锚定小浮层,`role="dialog"`)、`Menu`(锚定菜单,配套 `MenuItem` / `MenuLinkItem` / `MenuLabel`)。两者都有 `side`(`'top'` | `'bottom'`,默认 `'bottom'`;底部操作台用 `'top'`)和 `align`(`'start'` | `'end'`,默认 `'start'`)。
- `feedback/`:`LoadingState`、`ErrorState`、`EmptyState`。
- `layout/`:`AppShell`。
- `src/theme/`:`ThemeToggle`。

### 规则

- 弹层只用 `Modal` / `SidePanel`,不要直接用 `ui/dialog` 或 `ui/sheet`。
- 舞台内的浮层卡片(`PickCard`、`ReviewPopover`、`HoverCard`)保持在舞台内绝对定位,不走 portal。
- 锚定小浮层只用 `Popover` / `Menu`。它们渲染在自己的包裹元素里、不走 portal:投屏全屏时只有教室页根节点子树可见,portal 到 `body` 的浮层既看不见还会抢焦点。
- `Popover` 打开时聚焦内容里带 `data-autofocus` 的元素,没有则聚焦第一个可聚焦元素;第一个可聚焦元素不适合直接回车时(例如行列弹层里的"减少排数"),把 `data-autofocus` 标在合适的输入框上。

### 图表、页面与数据约定

- 图表只用 `shared/components/charts/*`(`ScoreBars` / `TrendLine` / `ScoreRadar` / `Sparkline`),测试里一律传 `width`。`TrendLine` 有 `yAxisWidth`(默认 40),刻度文字长(如“第 N 名”)时传宽一些(档案排名曲线传 64,放得下两位数名次)。
- 新页面用 `ClassGate`(`roles/teacher/ClassGate.tsx`),由它负责加载 / 出错 / 无班级 / 缺权限。
- 档案抽屉用 `useStudentDrawer`(`?student=<student_id>&tab=`,任何页面都能开);不再有 `/teacher/students/:id` 路由,旧地址跳转到教室页。
- 名单顺序统一用 `shared/lib/rosterOrder.ts` 的 `compareRoster`(学号按数字比较,空学号在后,再按姓名)。服务端名单是学号文本顺序,前端展示和导出前都要再排。例外:教室黑板“本周之星 / 本月寿星”的同分次序仍由 `Classroom/buildBoard.ts` 自己的比较函数决定(不在本次范围)。
- 有未保存修改的页面用 teacher store(`shared/stores/teacher.ts`)的 `setUnsaved(key, dirty)` 登记(`key` 为 `UnsavedKey`:`'seating'` | `'scores'`),顶栏换班 / 退出登录用 `confirmLeave()` 统一确认;站内跳转仍由页面自己的 `useBlocker` 拦。
- 投屏:成绩模式在投屏时不着色、不显示角标和图例(用户决定:投屏不公开排名)。

### AI 与 Markdown

- Markdown 只用 `shared/components/Markdown`(不渲染图片,不用 `dangerouslySetInnerHTML`)。
- 跳到 AI 页只用 `shared/lib/aiLink`(`aiLink()` 生成地址、`readAiLink()` 读预填参数),不要在别处拼 `/teacher/ai?...`。
- 流式接口只用 `shared/api/sse.ts` 的 `streamSSE`:抛 `ApiError` 表示没开始生成,抛 `AbortError` 表示老师点了停止,服务端自己把已生成的内容落库为 `stopped`。
- 导出 Word 只用 `shared/lib/exportWord`。

### 配置 AI(本地开发)

后端的 AI 配置见根目录 README“配置 AI”。本地不连真服务商时,起假服务 `node e2e/helpers/fakeLlm.mjs`,再在 `server/` 下执行 `printf 'test-key\n' | uv run python -m app.cli ai-config set --provider custom --base-url http://127.0.0.1:18089/v1 --model fake-model --api-key-stdin`。真 Key 只从标准输入给,不写进任何文件、不进仓库。

### 教室操作台

- 新模式的操作放进 `ModeSlot.actions`(`ClassroomPage.tsx`);次要操作放进 `ModeSlot.menu`(用 `MenuItem`),由 `ClassroomDock` 渲染成唯一的"更多操作"菜单;不再在舞台上方加工具条。
- `ClassroomDock` 的 `common`(随机点名、编辑黑板)只在日常模式显示;其他模式由页面把这两项追加到"更多操作"菜单末尾。
- 待办与最近点评放在操作台最右端的"待办与点评"抽屉(`SidePanel`),投屏全屏时不显示。
- `actions` 的子节点要保持在同一树位置:`Popover` 没有受控 `open`,重挂载会丢掉打开状态和已输入的数字。
- 缩放悬浮钮由 `ClassroomMap` 的 `zoomControls` 提供(舞台右下角);到缩放上下限时按钮用 `aria-disabled` 而不是 `disabled`,键盘焦点留在原处。
- 两翼:场景按 16:9(`SCENE_ASPECT`,`computeLayout` 的 `aspect` 选项)加宽,两翼(`art/Wings.tsx`、`art/wingArt.tsx`)是纯装饰、带 `aria-hidden`;"适应"比例横向只按中央安全区宽度计算(纵向按整幅高度),窄屏只裁掉两翼。

### 新增 shadcn 组件

```bash
npx shadcn@2.3.0 add -y <name>
npm i tailwind-merge@^2.6.0
npm ls tailwind-merge @radix-ui/react-dialog
```

`tailwind-merge` 必须保持 2.x(3.x 只支持 Tailwind 4);`@radix-ui/react-dialog` 固定为精确的 1.1.15。

### 新页面检查清单

- [ ] 有加载、空、错误三种状态(用 `feedback/` 组件)
- [ ] 键盘焦点可见
- [ ] 375px 宽无横向滚动
- [ ] 深色模式下检查一遍
