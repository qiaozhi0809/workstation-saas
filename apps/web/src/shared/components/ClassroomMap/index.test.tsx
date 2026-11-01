import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { StudentSeat } from '@/shared/types/student'
import ClassroomMap from './index'

const seat = (over: Partial<StudentSeat>): StudentSeat => ({
  enrollment_id: 'e1', student_id: 's1', name: '王小一', mk: 'S0001',
  seat_row: 1, seat_col: 1, avatar_seed: null, ...over,
})

it('renders seated students and skips unseated ones', () => {
  render(<ClassroomMap rows={2} cols={2} seats={[
    seat({}), seat({ enrollment_id: 'e2', name: '李小二', seat_row: null, seat_col: null }),
  ]} />)
  expect(screen.getByText('王小一')).toBeInTheDocument()
  expect(screen.queryByText('李小二')).toBeNull()
})

it('calls onSeatClick and shows hover card', () => {
  const onClick = vi.fn()
  render(<ClassroomMap rows={2} cols={2} seats={[seat({})]} onSeatClick={onClick} />)
  fireEvent.mouseEnter(screen.getByText('王小一'))
  expect(screen.getByText('编号 S0001')).toBeInTheDocument()
  fireEvent.click(screen.getAllByText('王小一')[0])
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ student_id: 's1' }))
})

it('hides the hover card on mouseLeave', () => {
  render(<ClassroomMap rows={2} cols={2} seats={[seat({})]} />)
  fireEvent.mouseEnter(screen.getByText('王小一'))
  expect(screen.getByText('编号 S0001')).toBeInTheDocument()
  fireEvent.mouseLeave(screen.getAllByText('王小一')[0].closest('g')!)
  expect(screen.queryByText('编号 S0001')).toBeNull()
})

it('renders dashed circles for empty cells', () => {
  const { container } = render(<ClassroomMap rows={2} cols={3} seats={[seat({})]} />)
  expect(container.querySelectorAll('circle[stroke-dasharray]')).toHaveLength(5)
})

it('does not render seats outside the grid', () => {
  render(<ClassroomMap rows={2} cols={2} seats={[seat({ seat_row: 3, seat_col: 1 })]} />)
  expect(screen.queryByText('王小一')).toBeNull()
})

it('halves the radius in mini mode', () => {
  const { container } = render(<ClassroomMap rows={2} cols={2} mode="mini" seats={[seat({})]} />)
  const filled = container.querySelector('circle:not([stroke-dasharray])')!
  expect(filled.getAttribute('r')).toBe('10')
})

it('triggers onSeatClick with Enter on a focused seat', () => {
  const onClick = vi.fn()
  render(<ClassroomMap rows={2} cols={2} seats={[seat({})]} onSeatClick={onClick} />)
  fireEvent.keyDown(screen.getByRole('button', { name: '王小一' }), { key: 'Enter' })
  expect(onClick).toHaveBeenCalledTimes(1)
})

it('shows the hover card on keyboard focus and hides it on blur', () => {
  render(<ClassroomMap rows={2} cols={2} seats={[seat({})]} onSeatClick={vi.fn()} />)
  const btn = screen.getByRole('button', { name: '王小一' })
  fireEvent.focus(btn)
  expect(screen.getByText('编号 S0001')).toBeInTheDocument()
  fireEvent.blur(btn)
  expect(screen.queryByText('编号 S0001')).toBeNull()
})
