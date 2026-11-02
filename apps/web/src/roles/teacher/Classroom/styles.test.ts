import { expect, it } from 'vitest'
import { findLegacyStyles } from '@/test/legacyStyles'

// 扫描教室页骨架四个文件;SeatHoverCard 迁移后加入断言
const files = import.meta.glob(
  ['./ClassroomPage.tsx', './Toolbar.tsx', './ModeBar.tsx', './SeatHoverCard.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

it('ClassroomPage / Toolbar / ModeBar use no legacy colour classes', () => {
  const migrated = ['./ClassroomPage.tsx', './Toolbar.tsx', './ModeBar.tsx']
  expect(findLegacyStyles(Object.fromEntries(migrated.map((f) => [f, files[f]])))).toEqual([])
})
