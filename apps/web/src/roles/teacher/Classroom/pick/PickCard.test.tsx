import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { groupColor } from '@/shared/components/ClassroomMap/art/palette'
import { groupOf } from '@/shared/lib/seats'
import type { DeskSize } from '@/shared/types/seating'
import type { StudentSeat } from '@/shared/types/student'
import { rosterFixture } from '../pageTestUtils'
import PickCard from './PickCard'

vi.mock('@/shared/components/ClassroomMap/art/Avatar', () => ({
  default: ({ color, title }: { color: string; title: string }) => (
    <span data-testid="avatar" data-color={color}>
      {title}
    </span>
  ),
}))

const seat = (over: Partial<StudentSeat>): StudentSeat => ({ ...rosterFixture[0], ...over })
const colorOf = (s: StudentSeat, desk: DeskSize, cols: number) => {
  const { unmount } = render(
    <PickCard
      seat={s}
      canReward={false}
      rewarding={false}
      onReward={() => {}}
      onAgain={() => {}}
      onClose={() => {}}
      groupOf={(x) => groupOf(x.seat_col ?? 1, desk, cols, x.seat_row ?? 1)}
    />,
  )
  const c = screen.getByTestId('avatar').getAttribute('data-color')
  unmount()
  return c
}

it('三人桌:同桌三人同色,下一桌换色', () => {
  const [a, b, c, d] = [1, 2, 3, 4].map((col) => colorOf(seat({ seat_col: col }), 3, 6))
  expect(a).toBe(groupColor(0))
  expect(b).toBe(a)
  expect(c).toBe(a)
  expect(d).toBe(groupColor(1))
})

it('单人桌:相邻两列同组', () => {
  const [a, b, c] = [1, 2, 3].map((col) => colorOf(seat({ seat_col: col }), 1, 4))
  expect(b).toBe(a)
  expect(c).toBe(groupColor(1))
})

it('讲台左右:左边第一组、右边最后一组', () => {
  expect(colorOf(seat({ seat_row: 0, seat_col: -1 }), 3, 6)).toBe(groupColor(0))
  expect(colorOf(seat({ seat_row: 0, seat_col: 1 }), 3, 6)).toBe(groupColor(1))
})
