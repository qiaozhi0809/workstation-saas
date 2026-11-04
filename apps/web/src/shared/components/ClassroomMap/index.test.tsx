import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { StudentSeat } from '@/shared/types/student'
import { GRADE_TINTS, ROOM } from './art/palette'
import ClassroomMap from './index'
import { fitName } from './SeatLayer'

const seat = (over: Partial<StudentSeat>): StudentSeat => ({
  enrollment_id: 'e1', student_id: 's1', name: '王小一', mk: 'S0001', seat_row: 1, seat_col: 1,
  avatar_seed: 'seed-01', gender: '男', student_no: '2026001', birthdate: null, class_role: null,
  seat_locked: false, ...over,
})
const q = (c: HTMLElement, sel: string) => c.querySelector(sel)

it('renders seated students and skips unseated or out-of-grid ones', () => {
  render(<ClassroomMap rows={2} cols={2} seats={[
    seat({}),
    seat({ enrollment_id: 'e2', name: '李小二', seat_row: null, seat_col: null }),
    seat({ enrollment_id: 'e3', name: '张小三', seat_row: 3, seat_col: 1 }),
  ]} />)
  expect(screen.getByText('王小一')).toBeInTheDocument()
  expect(screen.queryByText('李小二')).toBeNull()
  expect(screen.queryByText('张小三')).toBeNull()
})

it('marks every empty cell and makes them clickable only with a handler', () => {
  const onEmpty = vi.fn()
  const { container, rerender } = render(<ClassroomMap rows={2} cols={3} seats={[seat({})]} />)
  expect(container.querySelectorAll('[data-seat]:not([data-enrollment])')).toHaveLength(5)
  expect(screen.queryByRole('button', { name: '空座 2排3列' })).toBeNull()
  rerender(<ClassroomMap rows={2} cols={3} seats={[seat({})]} onEmptySeatClick={onEmpty} />)
  fireEvent.click(screen.getByRole('button', { name: '空座 2排3列' }))
  expect(onEmpty).toHaveBeenCalledWith({ row: 2, col: 3 })
})

it('reports clicks with an anchor and supports Enter', () => {
  const onClick = vi.fn()
  render(<ClassroomMap rows={2} cols={2} seats={[seat({})]} onSeatClick={onClick} />)
  const btn = screen.getByRole('button', { name: /^王小一，/ })
  fireEvent.click(btn)
  fireEvent.keyDown(btn, { key: 'Enter' })
  expect(onClick).toHaveBeenCalledTimes(2)
  expect(onClick.mock.calls[0][0]).toMatchObject({ enrollment_id: 'e1' })
  expect(onClick.mock.calls[0][1]).toEqual(expect.objectContaining({ left: expect.any(Number) }))
})

it('applies seat views', () => {
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={[seat({ class_role: '班长' })]}
    views={{ e1: { ghost: true, chip: { text: '请假', tone: 'amber' },
      badge: { text: '+3', tone: 'green' }, locked: true, selected: true } }} />)
  expect(q(container, '[data-enrollment="e1"][data-ghost="true"]')).not.toBeNull()
  expect(screen.getByText('请假')).toBeInTheDocument()
  expect(screen.getByText('+3')).toBeInTheDocument()
  expect(screen.getByText('班长')).toBeInTheDocument()
  expect(screen.getByLabelText('固定座位')).toBeInTheDocument()
  expect(q(container, '.cr-selected')).not.toBeNull()
})

it('drives poses and effects', () => {
  const two = [seat({}), seat({ enrollment_id: 'e2', student_id: 's2', name: '李小二', seat_col: 2 })]
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={two}
    effects={{ idle: { e1: 'doze' }, pickedId: 'e2', spotlightId: 'e2',
      floats: [{ key: 'f1', enrollmentId: 'e1', text: '+2', tone: 'plus' }] }} />)
  expect(q(container, '[data-enrollment="e1"] [data-pose="doze"]')).not.toBeNull()
  expect(q(container, '[data-enrollment="e2"] [data-pose="stand"]')).not.toBeNull()
  expect(q(container, '.cr-spotlight')).not.toBeNull()
  expect(q(container, '[data-action="point"]')).not.toBeNull()
  expect(screen.getByText('+2')).toBeInTheDocument()
})

it('renders the chosen teacher figure and label', () => {
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={[]}
    teacher={{ figure: 'male', label: '张老师 · 班主任' }} />)
  expect(q(container, '[data-figure="male"]')).not.toBeNull()
  expect(screen.getByText('张老师 · 班主任')).toBeInTheDocument()
})

it('keeps the mini map bare and the overview map read-only', () => {
  const { container, rerender } = render(
    <ClassroomMap rows={2} cols={2} seats={[seat({})]} mode="mini" onSeatClick={vi.fn()} />)
  expect(q(container, '[data-zone]')).toBeNull()
  expect(screen.queryByText('本周之星')).toBeNull()
  rerender(<ClassroomMap rows={2} cols={2} seats={[seat({})]} mode="overview" onSeatClick={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
})

it('truncates long names', () => {
  expect(fitName('欧阳纳兰容若')).toBe('欧阳纳兰容…')
  expect(fitName('王小一')).toBe('王小一')
})

it('exposes name, position, chip, badge and lock in the seat accessible name', () => {
  const views = { e1: { chip: { text: '请假', tone: 'amber' as const }, badge: { text: '+3', tone: 'green' as const }, locked: true } }
  render(<ClassroomMap rows={3} cols={3} seats={[seat({ seat_row: 2, seat_col: 3 })]} views={views} onSeatClick={vi.fn()} />)
  expect(screen.getByRole('button', { name: '王小一，第2排第3列，请假，+3，已锁定' })).toBeInTheDocument()
})

it('keeps the plain name and position when the seat shows no status', () => {
  render(<ClassroomMap rows={3} cols={3} seats={[seat({ seat_row: 2, seat_col: 3 })]} onSeatClick={vi.fn()} />)
  expect(screen.getByRole('button', { name: '王小一，第2排第3列' })).toBeInTheDocument()
})

it('paints desk tops by grade tint without touching figures', () => {
  const two = [seat({}), seat({ enrollment_id: 'e2', student_id: 's2', name: '李小二', seat_col: 2 })]
  const { container } = render(<ClassroomMap rows={1} cols={3} seats={two} views={{ e1: { tint: 1 }, e2: { tint: 5 } }} />)
  const tops = Array.from(container.querySelectorAll('.cr-desk')).map((d) => d.querySelector('rect')!.getAttribute('fill'))
  expect(tops).toEqual([GRADE_TINTS[1], GRADE_TINTS[5], ROOM.desk])
  // 学生身体与椅子不变色
  expect(container.querySelector('[data-enrollment="e1"]')!.innerHTML).not.toContain(GRADE_TINTS[1])
})

it('repaints a memoised seat when only the tint changes, and keeps tint out of the accessible name', () => {
  const props = { rows: 1, cols: 2, seats: [seat({})], onSeatClick: vi.fn() }
  const { container, rerender } = render(<ClassroomMap {...props} views={{ e1: { tint: 1 } }} />)
  expect(container.querySelector('.cr-desk rect')!.getAttribute('fill')).toBe(GRADE_TINTS[1])
  rerender(<ClassroomMap {...props} views={{ e1: { tint: 4 } }} />)
  expect(container.querySelector('.cr-desk rect')!.getAttribute('fill')).toBe(GRADE_TINTS[4])
  expect(screen.getByRole('button', { name: '王小一，第1排第1列' })).toBeInTheDocument()
})

describe('desk types and podium seats', () => {
  it('renders podium seats after the grid cells and names them by side', () => {
    const { container } = render(<ClassroomMap rows={2} cols={3} deskSize={3} podium={{ left: 1, right: 0 }}
      seats={[seat({ seat_row: 0, seat_col: -1 })]} onSeatClick={() => undefined} onEmptySeatClick={() => undefined} />)
    expect(container.querySelectorAll('[data-seat]')).toHaveLength(2 * 3 + 1)
    expect(q(container, '[data-seat="0--1"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /^王小一，讲台左边/ })).toBeInTheDocument()
  })
  it('podium seats come first in tab order', () => {
    const { container } = render(<ClassroomMap rows={2} cols={2} deskSize={1} podium={{ left: 2, right: 2 }}
      seats={[]} onEmptySeatClick={() => undefined} />)
    const order = Array.from(container.querySelectorAll('[data-seat][tabindex="0"]')).map((e) => e.getAttribute('data-seat'))
    expect(order.slice(0, 6)).toEqual(['0--2', '0--1', '0-1', '0-2', '1-1', '1-2'])
  })
  it('names an empty podium seat', () => {
    render(<ClassroomMap rows={2} cols={3} deskSize={3} podium={{ left: 1, right: 0 }} seats={[]} onEmptySeatClick={() => undefined} />)
    expect(screen.getByRole('button', { name: '空座 讲台左边' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '空座 2排3列' })).toBeInTheDocument()
  })
})

describe('mini map highlight', () => {
  const crowd = [
    seat({}),
    seat({ enrollment_id: 'e2', student_id: 's2', name: '李小二', seat_col: 2 }),
    seat({ enrollment_id: 'e3', student_id: 's3', name: '张小三', seat_row: 2, seat_col: 1 }),
  ]

  it('shows only the highlighted seat name and exposes only that seat', () => {
    const { container } = render(<ClassroomMap rows={2} cols={2} seats={crowd} mode="mini" highlight={['e2']} />)
    expect(screen.getByText('李小二')).toBeInTheDocument()
    expect(screen.queryByText('王小一')).toBeNull()
    expect(screen.queryByText('张小三')).toBeNull()
    expect(screen.getAllByRole('img', { name: /的座位/ })).toHaveLength(1)
    expect(screen.getByRole('img', { name: '李小二的座位，第1排第2座' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // 其余占用座位只画桌面:没有学生形象
    expect(container.querySelectorAll('[data-pose]')).toHaveLength(1)
    expect(q(container, '.cr-selected')).not.toBeNull()
  })

  it('does not make any seat clickable or hoverable', () => {
    const onClick = vi.fn()
    const { container } = render(<ClassroomMap rows={2} cols={2} seats={crowd} mode="mini" highlight={['e2']}
      onSeatClick={onClick} onEmptySeatClick={onClick} />)
    fireEvent.click(container.querySelector('[data-seat="1-2"]')!)
    fireEvent.mouseEnter(container.querySelector('[data-seat="1-2"]')!)
    expect(onClick).not.toHaveBeenCalled()
    expect(container.querySelector('[data-seat="1-1"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('names podium-side seats by side', () => {
    render(<ClassroomMap rows={2} cols={2} podium={{ left: 1, right: 0 }} mode="mini" highlight={['e9']}
      seats={[seat({ enrollment_id: 'e9', name: '赵小九', seat_row: 0, seat_col: -1 })]} />)
    expect(screen.getByRole('img', { name: '赵小九的座位，讲台左侧' })).toBeInTheDocument()
  })

  it('ignores highlight outside mini mode', () => {
    const { container, rerender } = render(<ClassroomMap rows={2} cols={2} seats={crowd} onSeatClick={vi.fn()} />)
    const before = container.innerHTML
    rerender(<ClassroomMap rows={2} cols={2} seats={crowd} onSeatClick={vi.fn()} highlight={['e2']} />)
    expect(container.innerHTML).toBe(before)
    expect(screen.getByText('王小一')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /，第/ })).toHaveLength(3)
  })
})
