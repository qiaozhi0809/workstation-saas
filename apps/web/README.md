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
- `overlay/`:`Modal`、`SidePanel`。
- `feedback/`:`LoadingState`、`ErrorState`、`EmptyState`。
- `layout/`:`AppShell`。
- `src/theme/`:`ThemeToggle`。

### 规则

- 弹层只用 `Modal` / `SidePanel`,不要直接用 `ui/dialog` 或 `ui/sheet`。
- 舞台内的浮层卡片(`PickCard`、`ReviewPopover`、`HoverCard`)保持在舞台内绝对定位,不走 portal。

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
