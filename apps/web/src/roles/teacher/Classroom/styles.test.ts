import { expect, it } from 'vitest'
import { findLegacyStyles } from '@/test/legacyStyles'

// 扫描教室页骨架四个文件;Toolbar / ModeBar / SeatHoverCard 迁移后逐个加入断言
const files = import.meta.glob(
  ['./ClassroomPage.tsx', './Toolbar.tsx', './ModeBar.tsx', './SeatHoverCard.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

it('ClassroomPage.tsx uses no legacy colour classes', () => {
  expect(findLegacyStyles({ './ClassroomPage.tsx': files['./ClassroomPage.tsx'] })).toEqual([])
})
