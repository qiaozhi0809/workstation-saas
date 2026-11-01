import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useRef } from 'react'
import { vi } from 'vitest'
import { Toaster, toast } from '@/shared/components/Toast'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { ClassroomSummary } from '@/shared/types/classroom'
import { buildBoard } from './buildBoard'
import ModeBar from './ModeBar'
import { useAttendanceDate } from './useAttendanceDate'
import { useFullscreen } from './useFullscreen'

it('shows only the modes my permissions allow and never a grades tab', () => {
  const { rerender } = render(<ModeBar mode="daily" onChange={vi.fn()}
    perms={['attendance.read', 'review.read', 'review.write', 'seating.write']} />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常', '考勤', '点评', '排座'])
  rerender(<ModeBar mode="daily" onChange={vi.fn()} perms={['attendance.read', 'review.read']} />)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常', '考勤', '点评'])
  expect(screen.queryByText('成绩')).toBeNull()
})

it('follows the server day after midnight unless a date was picked', () => {
  const { result, rerender } = renderHook(({ today }) => useAttendanceDate(today),
    { initialProps: { today: '2026-11-01' } })
  expect(result.current.date).toBe('2026-11-01')
  rerender({ today: '2026-11-02' })
  expect(result.current.date).toBe('2026-11-02')
  act(() => result.current.pick('2026-10-30'))
  rerender({ today: '2026-11-03' })
  expect(result.current.date).toBe('2026-10-30')
  act(() => result.current.followToday())
  expect(result.current.date).toBe('2026-11-03')
})

it('closes only the topmost layer on Escape', () => {
  const lower = vi.fn(), upper = vi.fn()
  renderHook(() => { useEscapeLayer(true, lower); useEscapeLayer(true, upper) })
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(upper).toHaveBeenCalledTimes(1)
  expect(lower).not.toHaveBeenCalled()
})

it('builds the board from summary, roster and weekly points', () => {
  const summary = { board: { left_title: '今日课程', left_text: '1 语文\n2 数学', right_title: '今日事项',
    right_text: '', countdown_label: '期末考试', countdown_date: '2027-01-15' } } as ClassroomSummary
  const roster = [
    { enrollment_id: 'e1', name: '王小一', student_no: '2', birthdate: '2017-11-03' },
    { enrollment_id: 'e2', name: '李小二', student_no: '1', birthdate: '2017-11-01' },
    { enrollment_id: 'e3', name: '张小三', student_no: '3', birthdate: '2017-05-01' },
  ].map((r) => ({ ...r, student_id: r.enrollment_id, mk: '', seat_row: 1, seat_col: 1, avatar_seed: null,
    gender: null, class_role: null, seat_locked: false }))
  const board = buildBoard({ className: '三年二班', today: '2026-11-02', summary, roster,
    reviewSummary: { week_start: '2026-11-02', items: [
      { enrollment_id: 'e1', total: 9, week: 3, plus_count: 3, minus_count: 0 },
      { enrollment_id: 'e2', total: 3, week: 3, plus_count: 3, minus_count: 0 },
      { enrollment_id: 'e3', total: 0, week: 0, plus_count: 0, minus_count: 0 },
    ] } })
  expect(board.screenTitle).toBe('三年二班 · 11月2日 星期一')
  expect(board.leftLines).toEqual(['1 语文', '2 数学'])
  expect(board.countdown).toEqual({ label: '期末考试', days: 74 })
  expect(board.stars.map((s) => s.name)).toEqual(['李小二', '王小一'])
  expect(board.birthdays).toEqual([{ name: '李小二', date: '11-01' }, { name: '王小一', date: '11-03' }])
})

it('drops an expired countdown and leaves stars empty without review totals', () => {
  const summary = { board: { left_title: '今日课程', left_text: '', right_title: '今日事项',
    right_text: '', countdown_label: '期中考试', countdown_date: '2026-11-01' } } as ClassroomSummary
  const board = buildBoard({ className: '三年二班', today: '2026-11-02', summary, roster: [] })
  expect(board.countdown).toBeNull()
  expect(board.stars).toEqual([])
  expect(board.rightLines).toEqual([])
})

it('ignores Escape layers that are inactive or unmounted', () => {
  const lower = vi.fn(), upper = vi.fn()
  const { rerender } = renderHook(({ on }) => { useEscapeLayer(true, lower); useEscapeLayer(on, upper) },
    { initialProps: { on: true } })
  rerender({ on: false })
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(lower).toHaveBeenCalledTimes(1)
  expect(upper).not.toHaveBeenCalled()
})

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('auto-dismisses after its duration', () => {
    render(<Toaster />)
    act(() => toast('已保存'))
    expect(screen.getByText('已保存')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2999) })
    expect(screen.getByText('已保存')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('已保存')).toBeNull()
  })

  it('runs the action from a real button and closes', () => {
    const onClick = vi.fn()
    render(<Toaster />)
    act(() => toast('已给 王小一 积极发言 +1', { action: { label: '撤销', onClick }, ms: 8000 }))
    act(() => { vi.advanceTimersByTime(5000) })
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('已给 王小一 积极发言 +1')).toBeNull()
  })
})

it('explains F11 when the browser cannot go fullscreen', () => {
  render(<Toaster />)
  const { result } = renderHook(() => {
    const ref = useRef<HTMLDivElement>(document.createElement('div'))
    return useFullscreen(ref)
  })
  act(() => result.current.toggle())
  expect(screen.getByText('浏览器不支持全屏,可以按 F11')).toBeInTheDocument()
  expect(result.current.active).toBe(false)
})
