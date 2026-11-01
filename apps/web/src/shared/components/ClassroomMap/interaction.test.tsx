import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { vi } from 'vitest'
import type { StudentSeat } from '@/shared/types/student'
import ClassroomMap from './index'
import type { ClassroomViewportHandle } from './types'

const seat = (id: string, name: string, col: number, over: Partial<StudentSeat> = {}): StudentSeat => ({
  enrollment_id: id, student_id: 's' + id, name, mk: 'S' + id, seat_row: 1, seat_col: col,
  avatar_seed: null, gender: '女', student_no: '20260' + id, birthdate: null, class_role: null,
  seat_locked: false, ...over,
})
const seats = [seat('1', '王小一', 1), seat('2', '李小二', 2)]
const cell = (c: HTMLElement, key: string) => c.querySelector(`[data-seat="${key}"]`)!
const scaleOf = (c: HTMLElement) =>
  Number(/scale\(([\d.]+)\)/.exec((c.querySelector('.cr-canvas') as HTMLElement).style.transform)![1])

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('shows the default hover card after a delay and turns the student around', () => {
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={seats} />)
  fireEvent.mouseEnter(cell(container, '1-1'))
  expect(screen.queryByText('学号 202601')).toBeNull()
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByText('学号 202601')).toBeInTheDocument()
  expect(container.querySelector('[data-enrollment="1"] [data-pose="turn"]')).not.toBeNull()
})

it('shows only the name while presenting', () => {
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={seats} presenting
    renderHoverCard={() => <span>今日请假</span>} />)
  fireEvent.mouseEnter(cell(container, '1-1'))
  act(() => vi.advanceTimersByTime(200))
  expect(screen.queryByText('今日请假')).toBeNull()
  expect(screen.queryByText('学号 202601')).toBeNull()
  expect(container.querySelector('.cr-hovercard')?.textContent).toBe('王小一')
})

it('zooms with ctrl+wheel and through the viewport handle', () => {
  const ref = createRef<ClassroomViewportHandle>()
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={seats} viewportRef={ref} />)
  const before = scaleOf(container)
  fireEvent.wheel(container.querySelector('.cr-stage')!, { deltaY: -200, ctrlKey: true })
  expect(scaleOf(container)).toBeGreaterThan(before)
  act(() => ref.current!.fit())
  expect(scaleOf(container)).toBe(before)
  act(() => ref.current!.zoomIn())
  expect(scaleOf(container)).toBeCloseTo(before * 1.2)
})

it('drags a student onto another seat', () => {
  const onDrop = vi.fn(), onClick = vi.fn()
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={seats}
    onSeatDrop={onDrop} onSeatClick={onClick} />)
  fireEvent.pointerDown(cell(container, '1-1'), { clientX: 0, clientY: 0, pointerId: 1, button: 0 })
  fireEvent.pointerMove(cell(container, '1-1'), { clientX: 20, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(cell(container, '1-2'), { clientX: 120, clientY: 0, pointerId: 1 })
  fireEvent.click(cell(container, '1-2'))
  expect(onDrop).toHaveBeenCalledWith({ row: 1, col: 1 }, { row: 1, col: 2 })
  expect(onClick).not.toHaveBeenCalled()
})

it('treats a tiny move as a click and never drags a locked student', () => {
  const onDrop = vi.fn(), onClick = vi.fn()
  const locked = [seat('1', '王小一', 1, { seat_locked: true }), seat('2', '李小二', 2)]
  const { container } = render(<ClassroomMap rows={1} cols={2} seats={locked}
    onSeatDrop={onDrop} onSeatClick={onClick} />)
  fireEvent.pointerDown(cell(container, '1-2'), { clientX: 0, clientY: 0, pointerId: 1, button: 0 })
  fireEvent.pointerMove(cell(container, '1-2'), { clientX: 3, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(cell(container, '1-2'), { clientX: 3, clientY: 0, pointerId: 1 })
  fireEvent.click(cell(container, '1-2'))
  expect(onClick).toHaveBeenCalledTimes(1)
  fireEvent.pointerDown(cell(container, '1-1'), { clientX: 0, clientY: 0, pointerId: 1, button: 0 })
  fireEvent.pointerMove(cell(container, '1-1'), { clientX: 30, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(cell(container, '1-2'), { clientX: 120, clientY: 0, pointerId: 1 })
  expect(onDrop).not.toHaveBeenCalled()
})
