import { expect, it } from 'vitest'
import { findLegacyStyles } from '@/test/legacyStyles'

// 扫描教室页骨架四个文件
const files = import.meta.glob(
  ['./ClassroomPage.tsx', './Toolbar.tsx', './ModeBar.tsx', './SeatHoverCard.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

it('ClassroomPage / Toolbar / ModeBar / SeatHoverCard use no legacy colour classes', () => {
  expect(Object.keys(files)).toHaveLength(4)
  expect(findLegacyStyles(files)).toEqual([])
})
