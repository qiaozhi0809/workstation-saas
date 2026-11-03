import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { groupOf } from '@/shared/lib/seats'
import type { ReviewSummary } from '@/shared/types/review'
import type { DeskSize } from '@/shared/types/seating'
import type { StudentSeat } from '@/shared/types/student'
import { rosterFixture } from '../pageTestUtils'
import Leaderboard from './Leaderboard'

const seat = (n: number, over: Partial<StudentSeat>): StudentSeat =>
  ({ ...rosterFixture[0], enrollment_id: `e${n}`, student_id: `s${n}`, name: `同学${n}`, ...over })
const summary = (totals: number[]): ReviewSummary => ({
  items: totals.map((total, i) => ({ enrollment_id: `e${i + 1}`, total, week: 0, plus_count: 0, minus_count: 0 })),
} as unknown as ReviewSummary)
const mk = (desk: DeskSize, cols: number) => (s: StudentSeat) => groupOf(s.seat_col ?? 1, desk, cols, s.seat_row ?? 1)
const groupTexts = () => screen.getAllByText(/^第 \d+ 组$/).map((e) => e.textContent)

it('三人桌:同桌三人合计为一组', () => {
  const roster = [1, 2, 3, 4].map((c) => seat(c, { seat_col: c }))
  render(<Leaderboard roster={roster} summary={summary([1, 1, 1, 5])} groupOf={mk(3, 6)} onClose={() => {}} />)
  expect(groupTexts()).toEqual(['第 2 组', '第 1 组'])
  expect(screen.getByText('第 1 组').nextSibling).toHaveTextContent('3')
})

it('单人桌:相邻两列同组', () => {
  const roster = [1, 2, 3].map((c) => seat(c, { seat_col: c }))
  render(<Leaderboard roster={roster} summary={summary([2, 2, 1])} groupOf={mk(1, 4)} onClose={() => {}} />)
  expect(screen.getByText('第 1 组').nextSibling).toHaveTextContent('4')
  expect(screen.getByText('第 2 组').nextSibling).toHaveTextContent('1')
})

it('讲台左边计第 1 组、右边计最后一组,不出现第 0 组', () => {
  const roster = [
    seat(1, { seat_row: 0, seat_col: -1 }),
    seat(2, { seat_row: 0, seat_col: 1 }),
    seat(3, { seat_row: 1, seat_col: 1 }),
    seat(4, { seat_row: 1, seat_col: 4 }),
    seat(5, { seat_row: null, seat_col: null }),
  ]
  render(<Leaderboard roster={roster} summary={summary([1, 10, 100, 1000, 7])} groupOf={mk(2, 4)} onClose={() => {}} />)
  expect(screen.queryByText('第 0 组')).toBeNull()
  expect(screen.getByText('第 1 组').nextSibling).toHaveTextContent('101')
  expect(screen.getByText('第 2 组').nextSibling).toHaveTextContent('1010')
})
