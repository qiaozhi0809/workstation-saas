import { cleanup, render, screen } from '@testing-library/react'
import { SCENE_ASPECT, computeLayout, type Layout } from '../layout'
import Wings from './Wings'
import {
  ATT_BOARD_MIN_H,
  ATT_BOARD_W,
  attendanceBoardRect,
  boardSlot,
  windowCount,
} from './wingArt'

it('paints both wing walls inside clip paths and nothing when the room is not widened', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(
    <svg>
      <Wings layout={L} />
    </svg>,
  )
  expect(container.querySelector('.cr-wings')).toHaveAttribute('aria-hidden', 'true')
  for (const side of ['left', 'right']) {
    const g = container.querySelector(`[data-wing="${side}"]`)!
    expect(g.querySelector('[clip-path]')).not.toBeNull()
  }
  const { container: none } = render(
    <svg>
      <Wings layout={computeLayout(6, 4)} />
    </svg>,
  )
  expect(none.querySelector('.cr-wings')).toBeNull()
})

it('draws as many windows as the left wall fits, each with a light patch', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(
    <svg>
      <Wings layout={L} />
    </svg>,
  )
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
  const { container } = render(
    <svg>
      <Wings layout={L} />
    </svg>,
  )
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(0)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(0)
})

it('shows the honor wall and cleaning corner only when the right wing is wide enough', () => {
  render(
    <svg>
      <Wings layout={computeLayout(6, 4, { aspect: SCENE_ASPECT })} />
    </svg>,
  )
  for (const t of ['荣誉墙', '班级公告', '值日表', '清洁角', '一', '五'])
    expect(screen.getByText(t)).toBeInTheDocument()
  cleanup()
  const { container } = render(
    <svg>
      <Wings layout={computeLayout(4, 8, { aspect: SCENE_ASPECT })} />
    </svg>,
  )
  expect(screen.queryByText('荣誉墙')).toBeNull()
  expect(screen.queryByText('值日表')).toBeNull()
  expect(container.querySelector('[data-wing="right"]')).not.toBeNull()
})

it('keeps the cleaning corner in the core while the wing is under WING_MIN, even if the floor could hold it', () => {
  // 现有行列算不出 240 ≤ dx < 280,手搭一个右翼 260 宽的布局;核心陈设区此时仍含清洁角,两翼不能再画一份
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const narrow = (r: { x: number; y: number; w: number; h: number }) => ({ ...r, w: 260 })
  const layout: Layout = {
    ...L,
    wings: {
      left: L.wings!.left,
      right: { wall: narrow(L.wings!.right.wall), floor: narrow(L.wings!.right.floor) },
    },
  }
  render(
    <svg>
      <Wings layout={layout} />
    </svg>,
  )
  expect(screen.queryByText('清洁角')).toBeNull()
  expect(screen.queryByText('荣誉墙')).toBeNull()
})

const BOARD = { title: '今日出勤', present: 8, total: 10, leave: 1, absent: 1, late: 2 }

it('puts the attendance board at the centre end of the window row; the other windows share the rest, one light patch each', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(
    <svg>
      <Wings layout={L} attendanceBoard={BOARD} />
    </svg>,
  )
  const left = container.querySelector('[data-wing="left"]')!
  // 669 宽的墙:192 的牌子 + 3 扇窗(均分剩余 429,每扇 127)
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(3)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(3)
  const xs = [...left.querySelectorAll('.cr-wing-window')].map((g) =>
    Number(/translate\(([\d.]+)/.exec(g.getAttribute('transform')!)![1]),
  )
  const bx = boardSlot(669, 220)!.x
  expect(xs).toEqual([12, 12 + 151, 12 + 302])
  expect(bx).toBe(12 + 453)
  expect(xs[2] + 127 + 24).toBeCloseTo(bx, 5)
  for (const g of left.querySelectorAll('.cr-wing-window > g > rect:first-child'))
    expect(Number(g.getAttribute('width'))).toBeCloseTo(127, 5)
  const board = left.querySelectorAll('[data-wing-board]')
  expect(board).toHaveLength(1)
  expect(container.querySelector('.cr-wings')!.contains(board[0])).toBe(true)
  for (const t of ['今日出勤', '实到', '8', '请假缺勤迟到'])
    expect(screen.getByText(t)).toBeInTheDocument()
  expect(screen.getByText('/10')).toBeInTheDocument()
  // 牌子画在最靠近中央那扇窗的位置:窗位 x(场景坐标)= 墙 x + 窗的本地 x
  const r = attendanceBoardRect(L)!
  const t = board[0].getAttribute('transform')!
  expect(t).toContain(`translate(${r.x - L.wings!.left.wall.x} ${r.y - L.wings!.left.wall.y})`)
  expect(r.w).toBe(ATT_BOARD_W)
})

it('draws windows exactly as before when no board is given', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(
    <svg>
      <Wings layout={L} />
    </svg>,
  )
  const left = container.querySelector('[data-wing="left"]')!
  expect(left.querySelectorAll('.cr-wing-window')).toHaveLength(4)
  expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(4)
  expect(container.querySelector('[data-wing-board]')).toBeNull()
  const w0 = left.querySelector('.cr-wing-window > g > rect')!
  expect(w0.getAttribute('width')).toBe('120')
})

it('is one and a half window slots wide and has thresholds on wall width and height', () => {
  expect(ATT_BOARD_W).toBe(1.5 * (120 + 24) - 24)
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  expect(attendanceBoardRect(L)).toEqual({ x: 16 + 465, y: 16 + 22, w: 192, h: 146 })
  // 宽度门槛:墙宽 − 24 ≥ 192
  expect(boardSlot(215, 220)).toBeNull()
  expect(boardSlot(216, 220)).toMatchObject({ w: 192 })
  // 高度门槛:牌高(= 窗高 = 墙高 − 67)≥ ATT_BOARD_MIN_H
  expect(boardSlot(669, 67 + ATT_BOARD_MIN_H - 1)).toBeNull()
  expect(boardSlot(669, 67 + ATT_BOARD_MIN_H)).toMatchObject({ h: ATT_BOARD_MIN_H })
  // 4 × 8 左翼约 201 宽放不下;4 × 9 与不加宽:没有牌子
  expect(computeLayout(4, 8, { aspect: SCENE_ASPECT }).wings!.left.wall.w).toBeLessThan(216)
  expect(attendanceBoardRect(computeLayout(4, 8, { aspect: SCENE_ASPECT }))).toBeNull()
  expect(attendanceBoardRect(computeLayout(4, 9, { aspect: SCENE_ASPECT }))).toBeNull()
  expect(attendanceBoardRect(computeLayout(6, 4))).toBeNull()
})

it('draws plain windows (no board) when the wing cannot fit the board', () => {
  for (const [r, c] of [
    [4, 8],
    [4, 9],
  ] as const) {
    const { container } = render(
      <svg>
        <Wings layout={computeLayout(r, c, { aspect: SCENE_ASPECT })} attendanceBoard={BOARD} />
      </svg>,
    )
    expect(container.querySelector('[data-wing-board]')).toBeNull()
    const left = container.querySelector('[data-wing="left"]')!
    expect(left.querySelectorAll('.cr-wing-light path')).toHaveLength(
      left.querySelectorAll('.cr-wing-window').length,
    )
    cleanup()
  }
  const { container } = render(
    <svg>
      <Wings layout={computeLayout(4, 8, { aspect: SCENE_ASPECT })} attendanceBoard={BOARD} />
    </svg>,
  )
  expect(container.querySelectorAll('[data-wing="left"] .cr-wing-window')).toHaveLength(1)
})

it('keeps the tone cells inside the board paper', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(
    <svg>
      <Wings layout={L} attendanceBoard={BOARD} />
    </svg>,
  )
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
    expect(y + h).toBeLessThanOrEqual(ph - 8)
  }
})
