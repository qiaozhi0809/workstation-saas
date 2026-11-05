import { expect, it } from 'vitest'
import type { ClassroomSummary } from '@/shared/types/classroom'
import { buildBoard } from './buildBoard'

const board = {
  left_title: '今日课程',
  left_text: '',
  right_title: '今日事项',
  right_text: '',
  countdown_label: null,
  countdown_date: null,
}
const roster = [
  { enrollment_id: 'e1', name: '王小一', student_no: '2', birthdate: '2017-11-03' },
  { enrollment_id: 'e2', name: '李小二', student_no: '1', birthdate: '2017-11-01' },
].map((r) => ({
  ...r,
  student_id: r.enrollment_id,
  mk: '',
  seat_row: 1,
  seat_col: 1,
  avatar_seed: null,
  gender: null,
  class_role: null,
  seat_locked: false,
}))
const reviewSummary = {
  week_start: '2026-11-02',
  items: [
    { enrollment_id: 'e1', total: 9, week: 3, plus_count: 3, minus_count: 0 },
    { enrollment_id: 'e2', total: 3, week: 2, plus_count: 2, minus_count: 0 },
  ],
}
const build = (switches?: ClassroomSummary['switches']) =>
  buildBoard({
    className: '三年二班',
    today: '2026-11-02',
    summary: { board, switches } as ClassroomSummary,
    roster,
    reviewSummary,
  })

it('keeps stars and birthdays when the switches are missing or on', () => {
  for (const b of [build(), build({ star_of_week: true, birthdays: true })]) {
    expect(b.stars.map((s) => s.name)).toEqual(['王小一', '李小二'])
    expect(b.birthdays.map((s) => s.name)).toEqual(['李小二', '王小一'])
  }
})

it('empties the stars when star_of_week is off, leaving birthdays', () => {
  const b = build({ star_of_week: false, birthdays: true })
  expect(b.stars).toEqual([])
  expect(b.birthdays).toHaveLength(2)
})

it('empties the birthdays when birthdays is off, leaving stars', () => {
  const b = build({ star_of_week: true, birthdays: false })
  expect(b.birthdays).toEqual([])
  expect(b.stars).toHaveLength(2)
})
