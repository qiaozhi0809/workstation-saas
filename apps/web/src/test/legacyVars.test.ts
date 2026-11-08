// Arc 的 foundation.css 在 :root 定义了同名变量(--background、--border、--accent 等),
// 项目自己的 shadcn 变量已全部改名 --ws-*;这里保证没有代码还在读任何旧名字(含带 fallback 的写法)。
const RENAMED = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'info',
  'info-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'radius',
]

it('no project code reads a renamed shadcn variable', () => {
  const files = import.meta.glob(
    [
      '/src/**/*.{ts,tsx,css}',
      '!/src/**/*.test.*',
      '!/src/shared/components/arc/**',
      '!/src/theme/arc-overrides.css',
    ],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>
  expect(Object.keys(files).length).toBeGreaterThan(0)
  const re = new RegExp(String.raw`var\(--(${RENAMED.join('|')})\s*[,)]`, 'g')
  const hits = Object.entries(files).flatMap(([p, s]) =>
    [...s.matchAll(re)].map((m) => `${p}: ${m[0]}`),
  )
  expect(hits).toEqual([])
})
