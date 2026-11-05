import type { Size } from './viewport'

interface Anchor {
  left: number
  top: number
  width: number
  height: number
}
const EDGE = 8

// 悬停卡位置(都相对舞台):优先右侧,放不下改左侧,两侧都放不下贴边;垂直以锚点中心对齐后夹在舞台内
export function placeCard(
  anchor: Anchor,
  card: Size,
  stage: Size,
  gap = 12,
): { left: number; top: number; side: 'right' | 'left' } {
  const right = anchor.left + anchor.width + gap,
    left = anchor.left - gap - card.w
  const top = Math.max(
    EDGE,
    Math.min(stage.h - card.h - EDGE, anchor.top + anchor.height / 2 - card.h / 2),
  )
  if (right + card.w <= stage.w - EDGE) return { left: right, top, side: 'right' }
  if (left >= EDGE) return { left, top, side: 'left' }
  const side = stage.w - (anchor.left + anchor.width) >= anchor.left ? 'right' : 'left'
  const edge = side === 'right' ? stage.w - card.w - EDGE : EDGE
  return { left: Math.max(EDGE, edge), top, side }
}
