import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { StudentSeat } from '@/shared/types/student'

const renders = vi.hoisted(() => ({ n: 0 }))
vi.mock('./art/Desk', async (orig) => {
  const mod = await orig<typeof import('./art/Desk')>()
  const Real = mod.default
  return { ...mod, default: (p: Parameters<typeof Real>[0]) => { renders.n++; return Real(p) } }
})

import ClassroomMap from './index'

const seat = (n: number): StudentSeat => ({
  enrollment_id: `e${n}`, student_id: `s${n}`, name: `学生${n}`, mk: `S${n}`, seat_row: 1, seat_col: n,
  avatar_seed: null, gender: '男', student_no: `${n}`, birthdate: null, class_role: null, seat_locked: false,
})

it('does not redraw desks whose colour is unchanged when views is a new object', () => {
  const seats = [seat(1), seat(2)]
  const { rerender } = render(<ClassroomMap rows={1} cols={2} seats={seats} views={{ e1: { tint: 1 }, e2: { tint: 2 } }} />)
  const first = renders.n
  expect(first).toBeGreaterThan(0)
  rerender(<ClassroomMap rows={1} cols={2} seats={seats} views={{ e1: { tint: 1 }, e2: { tint: 2 } }} />)
  expect(renders.n).toBe(first)
  // 只有 e2 的颜色变了:只重画那一张桌子
  rerender(<ClassroomMap rows={1} cols={2} seats={seats} views={{ e1: { tint: 1 }, e2: { tint: 3 } }} />)
  expect(renders.n).toBe(first + 1)
})
