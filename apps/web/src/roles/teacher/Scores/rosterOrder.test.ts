import { expect, it } from 'vitest'
import type { StudentSeat } from '@/shared/types/student'
import { compareRoster } from './rosterOrder'

const seat = (name: string, no: string | null): StudentSeat => ({
  enrollment_id: name, student_id: name, name, mk: name, seat_row: null, seat_col: null,
  avatar_seed: null, gender: null, student_no: no, birthdate: null, class_role: null, seat_locked: false,
})

it('orders student numbers numerically with empty ones last, then by name', () => {
  const list = [seat('甲', null), seat('乙', '10'), seat('丙', '2'), seat('丁', '10')]
  expect([...list].sort(compareRoster).map((s) => `${s.student_no ?? ''}${s.name}`)).toEqual(['2丙', '10丁', '10乙', '甲'].map((x) => x))
})
