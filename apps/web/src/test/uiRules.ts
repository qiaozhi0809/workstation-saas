// M6 界面统一的棘轮守卫:按行匹配源码里不该再出现的写法。
// 规则只增不减,命中数只许下降(BASELINE 在 uiRules.test.ts),Z 段把 BASELINE 全部收成 0。
export interface UiRule {
  id: string
  re: RegExp
  /** 返回 true 的路径(相对 apps/web,如 `src/shared/components/ui/table.tsx`)不计入这条规则 */
  allow?: (path: string) => boolean
}

const inUi = (p: string) => p.startsWith('src/shared/components/ui/')

export const UI_RULES: readonly UiRule[] = [
  { id: 'semibold', re: /\bfont-(semibold|bold)\b/ },
  {
    id: 'big-radius',
    re: /\brounded-(3xl|\[[^\]]+\])/,
    // 图表图例的 2px 色块:比最小的 rounded-sm 还小,是数据标记不是卡片圆角
    allow: (p) => p === 'src/shared/components/ui/chart.tsx',
  },
  {
    id: 'raw-table',
    re: /<table\b/,
    // ExamDetail:家长端窄屏要把每科渲染成两行卡片(计划 L83),原生 table + display 切换,
    // 共享 Table 做不到
    allow: (p) =>
      p === 'src/shared/components/ui/table.tsx' || p === 'src/roles/parent/Grades/ExamDetail.tsx',
  },
  {
    id: 'raw-h1',
    re: /<h1\b/,
    // auth/:登录、改密、两步验证是没有侧栏和 PageContainer 的独立居中卡片,标题就是卡片标题
    allow: (p) =>
      p === 'src/shared/components/ui/page.tsx' ||
      p === 'src/roles/teacher/ClassGate.tsx' ||
      p.startsWith('src/auth/'),
  },
  { id: 'button-height', re: /<Button[^>]*className="[^"]*\bh-\d/ },
  { id: 'tracking-tight', re: /\btracking-tight\b/ },
  { id: 'transition-all', re: /\btransition-all\b/ },
  {
    id: 'arc-import-in-pages',
    re: /from '@\/shared\/components\/arc\//,
    allow: (p) =>
      p.startsWith('src/shared/components/ui/') ||
      p.startsWith('src/shared/components/layout/') ||
      p.startsWith('src/shared/components/feedback/'),
  },
  { id: 'bordered-card', re: /\brounded-(md|lg|xl) border\b/, allow: inUi },
  {
    id: 'pill-chip',
    re: /\brounded-full\b[^"]*\bpx-/,
    // 导航项上的圆形未读计数角标(家长端底栏、通知铃):角标必须是圆的,不是药丸标签
    allow: (p) =>
      p === 'src/roles/parent/ParentNav.tsx' || p === 'src/shared/components/layout/NoticeBell.tsx',
  },
]

/** files: 路径(相对 apps/web,以 `src/` 开头)→ 源码。返回 规则 id → 命中的 "path:line"(每行最多算一次)。 */
export function countUiRuleHits(files: Record<string, string>): Record<string, string[]> {
  const hits: Record<string, string[]> = Object.fromEntries(UI_RULES.map((r) => [r.id, []]))
  for (const [path, source] of Object.entries(files)) {
    const lines = source.split('\n')
    for (const rule of UI_RULES) {
      if (rule.allow?.(path)) continue
      lines.forEach((line, i) => {
        if (rule.re.test(line)) hits[rule.id].push(`${path}:${i + 1}`)
      })
    }
  }
  return hits
}
