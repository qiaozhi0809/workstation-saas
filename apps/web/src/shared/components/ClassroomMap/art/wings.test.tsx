import { cleanup, render, screen } from '@testing-library/react'
import { SCENE_ASPECT, computeLayout, type Layout } from '../layout'
import Wings from './Wings'
import { attendanceBoardRect, windowCount } from './wingArt'

it('paints both wing walls inside clip paths and nothing when the room is not widened', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} /></svg>)
  expect(container.querySelector('.cr-wings')).toHaveAttribute('aria-hidden', 'true')
  for (const side of ['left', 'right']) {
    const g = container.querySelector(`[data-wing="${side}"]`)!
    expect(g.querySelector('[clip-path]')).not.toBeNull()
  }
  const { container: none } = render(<svg><Wings layout={computeLayout(6, 4)} /></svg>)
  expect(none.querySelector('.cr-wings')).toBeNull()
})

it('draws as many windows as the left wall fits, each with a light patch', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} /></svg>)
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(windowCount(669))
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(windowCount(669))
  expect(left.querySelectorAll('.cr-wing-window [clip-path]')).toHaveLength(windowCount(669))
  expect(windowCount(669)).toBe(4)
  expect(windowCount(167)).toBe(0)
})

it('draws no windows and no light patches on a wing too narrow for one window', () => {
  // 4 × 9 加宽后两翼只有 81 宽
  const L = computeLayout(4, 9, { aspect: SCENE_ASPECT })
  expect(L.wings!.left.wall.w).toBe(81)
  const { container } = render(<svg><Wings layout={L} /></svg>)
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(0)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(0)
})

it('shows the honor wall and cleaning corner only when the right wing is wide enough', () => {
  render(<svg><Wings layout={computeLayout(6, 4, { aspect: SCENE_ASPECT })} /></svg>)
  for (const t of ['荣誉墙', '班级公告', '值日表', '清洁角', '一', '五']) expect(screen.getByText(t)).toBeInTheDocument()
  cleanup()
  const { container } = render(<svg><Wings layout={computeLayout(4, 8, { aspect: SCENE_ASPECT })} /></svg>)
  expect(screen.queryByText('荣誉墙')).toBeNull()
  expect(screen.queryByText('值日表')).toBeNull()
  expect(container.querySelector('[data-wing="right"]')).not.toBeNull()
})

it('keeps the cleaning corner in the core while the wing is under WING_MIN, even if the floor could hold it', () => {
  // 现有行列算不出 240 ≤ dx < 280,手搭一个右翼 260 宽的布局;核心陈设区此时仍含清洁角,两翼不能再画一份
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const narrow = (r: { x: number; y: number; w: number; h: number }) => ({ ...r, w: 260 })
  const layout: Layout = { ...L, wings: { left: L.wings!.left, right: { wall: narrow(L.wings!.right.wall), floor: narrow(L.wings!.right.floor) } } }
  render(<svg><Wings layout={layout} /></svg>)
  expect(screen.queryByText('清洁角')).toBeNull()
  expect(screen.queryByText('荣誉墙')).toBeNull()
})

const BOARD = { title: '今日出勤', present: 8, total: 10, leave: 1, absent: 1, late: 2 }

it('swaps the window nearest the centre for the attendance board and drops its light patch', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} attendanceBoard={BOARD} /></svg>)
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(windowCount(669) - 1)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(windowCount(669) - 1)
  const board = left.querySelectorAll('[data-wing-board]')
  expect(board).toHaveLength(1)
  expect(container.querySelector('.cr-wings')!.contains(board[0])).toBe(true)
  for (const t of ['今日出勤', '实到', '8', '请假缺勤迟到']) expect(screen.getByText(t)).toBeInTheDocument()
  expect(screen.getByText('/10')).toBeInTheDocument()
  // 牌子画在最靠近中央那扇窗的位置:窗位 x(场景坐标)= 墙 x + 窗的本地 x
  const r = attendanceBoardRect(L)!
  const t = board[0].getAttribute('transform')!
  expect(t).toContain(`translate(${r.x - L.wings!.left.wall.x} ${r.y - L.wings!.left.wall.y})`)
})

it('draws windows exactly as before when no board is given', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} /></svg>)
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(4)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(4)
  expect(container.querySelector('[data-wing-board]')).toBeNull()
})

it('puts the board in the rightmost window slot and has none when there is no slot', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  expect(attendanceBoardRect(L)).toEqual({ x: 16 + 490.5, y: 16 + 22, w: 120, h: 146 })
  // 4 × 8:左翼只放得下一扇窗,牌子占了它;4 × 9 与不加宽:没有窗位就没有牌子
  const one = attendanceBoardRect(computeLayout(4, 8, { aspect: SCENE_ASPECT }))!
  expect(one.w).toBe(120)
  expect(attendanceBoardRect(computeLayout(4, 9, { aspect: SCENE_ASPECT }))).toBeNull()
  expect(attendanceBoardRect(computeLayout(6, 4))).toBeNull()
  const { container } = render(<svg><Wings layout={computeLayout(4, 9, { aspect: SCENE_ASPECT })} attendanceBoard={BOARD} /></svg>)
  expect(container.querySelector('[data-wing-board]')).toBeNull()
})

it('keeps the tone cells inside the board paper', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} attendanceBoard={BOARD} /></svg>)
  const board = container.querySelector('[data-wing-board]')!
  const paper = board.querySelector('rect')!
  const cells = board.querySelectorAll('[data-board-cell]')
  expect(cells).toHaveLength(3)
  const [pw, ph] = [Number(paper.getAttribute('width')), Number(paper.getAttribute('height'))]
  for (const c of cells) {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(c.getAttribute(a)))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(pw)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y + h).toBeLessThanOrEqual(ph - 6)
  }
})
