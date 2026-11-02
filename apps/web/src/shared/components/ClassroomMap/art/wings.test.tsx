import { cleanup, render, screen } from '@testing-library/react'
import { SCENE_ASPECT, computeLayout, type Layout } from '../layout'
import Wings from './Wings'
import { windowCount } from './wingArt'

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
