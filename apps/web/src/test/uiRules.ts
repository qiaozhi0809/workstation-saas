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
  { id: 'big-radius', re: /\brounded-(3xl|\[[^\]]+\])/ },
  { id: 'raw-table', re: /<table\b/, allow: (p) => p === 'src/shared/components/ui/table.tsx' },
  {
    id: 'raw-h1',
    re: /<h1\b/,
    allow: (p) =>
      p === 'src/shared/components/ui/page.tsx' || p === 'src/roles/teacher/ClassGate.tsx',
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
  { id: 'pill-chip', re: /\brounded-full\b[^"]*\bpx-/ },
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
