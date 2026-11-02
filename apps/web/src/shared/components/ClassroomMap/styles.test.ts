import { expect, it } from 'vitest'
import { findLegacyStyles } from '@/test/legacyStyles'

// 只扫 HoverCard:地图其余文件是冻结的 SVG 部件
const files = import.meta.glob(['./HoverCard.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

it('HoverCard uses no legacy colour classes', () => {
  expect(Object.keys(files)).toHaveLength(1)
  expect(findLegacyStyles(files)).toEqual([])
})
