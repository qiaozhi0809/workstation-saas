import { findLegacyStyles } from '@/test/legacyStyles'

it('no non-test TS/TSX file uses legacy colour names, palette colours, white/black or hex classes', () => {
  const files = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })
  expect(Object.keys(files).length).toBeGreaterThan(0)
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})

it('tailwind config has no legacy colour aliases', () => {
  // 读原文而不是执行配置:避免在 jsdom 里加载 Tailwind 插件
  const config = Object.values(import.meta.glob('/tailwind.config.ts', { query: '?raw', import: 'default', eager: true }))[0] as string
  for (const legacy of ['ink', 'line', 'panel', 'side', 'fill', 'blue', 'red', 'amber', 'green'])
    expect(config).not.toMatch(new RegExp(String.raw`^\s*${legacy}:`, 'm'))
})
