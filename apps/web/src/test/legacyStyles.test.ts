import { findLegacyStyles } from './legacyStyles'

it('flags legacy colour names, palette colours, white/black and arbitrary hex', () => {
  const hits = findLegacyStyles({
    'a.tsx': `<div className="bg-panel text-ink-2 hover:bg-fill border-line-2 text-amber aria-[invalid=true]:border-red" />`,
    'b.tsx': "<p className={`text-red-500 ${x ? 'bg-white' : 'bg-black/30'} bg-[#f5f5f4]`} />",
  })
  expect(hits).toEqual([
    'a.tsx: bg-panel', 'a.tsx: text-ink-2', 'a.tsx: hover:bg-fill', 'a.tsx: border-line-2', 'a.tsx: text-amber',
    'a.tsx: aria-[invalid=true]:border-red',
    'b.tsx: text-red-500', 'b.tsx: bg-white', 'b.tsx: bg-black/30', 'b.tsx: bg-[#f5f5f4]',
  ])
})

it('accepts semantic tokens and non-colour utilities', () => {
  expect(findLegacyStyles({
    'c.tsx': `<div className="bg-background text-muted-foreground border-border bg-warning/10 text-success ring-ring
      fill-current text-sm red-flag" data-x="#fff" />`,
  })).toEqual([])
})
