// Arc 的 foundation.css 在 :root 定义了同名变量(--background、--border、--accent 等),
// 项目自己的 shadcn 变量已改名 --ws-*;这里保证没有代码还在读那 8 个会撞名的旧名字。
it('no project code reads the 8 names that collide with Arc', () => {
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
  const re = /var\(--(background|foreground|border|accent|accent-foreground|info|success|warning)\)/g
  const hits = Object.entries(files).flatMap(([p, s]) =>
    [...s.matchAll(re)].map((m) => `${p}: ${m[0]}`),
  )
  expect(hits).toEqual([])
})
