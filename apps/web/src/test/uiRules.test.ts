import { countUiRuleHits, UI_RULES } from './uiRules'

const sources = import.meta.glob(
  [
    '/src/**/*.tsx',
    '!/src/**/*.test.*',
    '!/src/shared/components/arc/**',
    '!/src/shared/components/ClassroomMap/**',
    '!/src/dev/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const files = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [path.replace(/^\//, ''), source]),
)

// 棘轮已收紧到 0:新代码不许再出现这些写法。确属例外的写进 uiRules.ts 对应规则的 allow(带理由)。
const BASELINE: Record<string, number> = {
  semibold: 0,
  'big-radius': 0,
  'raw-table': 0,
  'raw-h1': 0,
  'button-height': 0,
  'tracking-tight': 0,
  'transition-all': 0,
  'arc-import-in-pages': 0,
  'bordered-card': 0,
  'pill-chip': 0,
}

describe('ui rules ratchet', () => {
  const hits = countUiRuleHits(files)

  it('scans the source tree', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50)
    expect(Object.keys(files).every((p) => p.startsWith('src/'))).toBe(true)
  })

  it('has a baseline for every rule', () => {
    expect(Object.keys(BASELINE).sort()).toEqual(UI_RULES.map((r) => r.id).sort())
  })

  it.each(Object.keys(BASELINE))('%s does not exceed its baseline', (id) => {
    expect(hits[id].length, `${id}:\n${hits[id].join('\n')}`).toBeLessThanOrEqual(BASELINE[id])
  })

  const examples: Record<string, { yes: string; no: string; allowedPath?: string }> = {
    semibold: { yes: '<b className="font-semibold">', no: '<b className="font-medium">' },
    'big-radius': { yes: 'className="rounded-3xl"', no: 'className="rounded-lg"' },
    'raw-table': {
      yes: '<table className="w-full">',
      no: '<Table>',
      allowedPath: 'src/shared/components/ui/table.tsx',
    },
    'raw-h1': {
      yes: '<h1 className="x">',
      no: '<PageHeader title="x" />',
      allowedPath: 'src/shared/components/ui/page.tsx',
    },
    'button-height': { yes: '<Button className="h-9 px-2">', no: '<Button className="px-2">' },
    'tracking-tight': { yes: 'className="tracking-tight"', no: 'className="tracking-wide"' },
    'transition-all': { yes: 'className="transition-all"', no: 'className="transition-colors"' },
    'arc-import-in-pages': {
      yes: "import { Button } from '@/shared/components/arc/button/button'",
      no: "import { Button } from '@/shared/components/ui/button'",
      allowedPath: 'src/shared/components/ui/button.tsx',
    },
    'bordered-card': {
      yes: 'className="rounded-lg border p-4"',
      no: 'className="rounded-lg shadow-surface p-4"',
      allowedPath: 'src/shared/components/ui/input.tsx',
    },
    'pill-chip': {
      yes: 'className="rounded-full bg-muted px-2"',
      no: 'className="rounded-md px-2"',
    },
  }

  it.each(UI_RULES.map((r) => r.id))('rule %s matches its own examples', (id) => {
    const ex = examples[id]
    const path = 'src/roles/x/Page.tsx'
    expect(countUiRuleHits({ [path]: ex.yes })[id]).toEqual([`${path}:1`])
    expect(countUiRuleHits({ [path]: ex.no })[id]).toEqual([])
    if (ex.allowedPath) expect(countUiRuleHits({ [ex.allowedPath]: ex.yes })[id]).toEqual([])
  })

  it('reports the line number of each hit', () => {
    const out = countUiRuleHits({ 'src/a.tsx': 'ok\n<b className="font-bold">\nok' })
    expect(out.semibold).toEqual(['src/a.tsx:2'])
  })
})
