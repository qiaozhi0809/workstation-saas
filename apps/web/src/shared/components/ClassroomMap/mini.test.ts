import { seatsFromMiniMap } from './mini'

const map = {
  rows: 4,
  cols: 4,
  desk_size: 2 as const,
  podium_left: 0,
  podium_right: 0,
  occupied: [
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 3 },
  ],
  mine: { row: 1, col: 2 },
}
const child = { enrollment_id: 'e-child', name: '王小一', gender: '男' }

it('makes one seat per occupied cell, the child in their own seat', () => {
  const { seats, highlight } = seatsFromMiniMap(map, child)
  expect(seats).toHaveLength(3)
  expect(highlight).toEqual(['e-child'])
  expect(seats.find((s) => s.enrollment_id === 'e-child')).toMatchObject({
    name: '王小一',
    gender: '男',
    seat_row: 1,
    seat_col: 2,
  })
})

it('keeps the other seats anonymous', () => {
  const { seats } = seatsFromMiniMap(map, child)
  const anon = seats.filter((s) => s.enrollment_id !== 'e-child')
  expect(anon.map((s) => s.enrollment_id)).toEqual(['seat:1:1', 'seat:2:3'])
  for (const s of anon) {
    expect(s).toMatchObject({
      name: '',
      student_id: '',
      mk: '',
      avatar_seed: null,
      gender: null,
      student_no: null,
      birthdate: null,
      class_role: null,
      seat_locked: false,
    })
  }
})

it('highlights nobody when the child has no seat', () => {
  const { seats, highlight } = seatsFromMiniMap({ ...map, mine: null }, child)
  expect(seats).toHaveLength(3)
  expect(highlight).toEqual([])
  expect(seats.every((s) => s.name === '')).toBe(true)
})

it('still draws the child when the map forgot to list their seat as occupied', () => {
  const { seats, highlight } = seatsFromMiniMap({ ...map, mine: { row: 3, col: 3 } }, child)
  expect(seats).toHaveLength(4)
  expect(seats.find((s) => s.enrollment_id === 'e-child')).toMatchObject({
    seat_row: 3,
    seat_col: 3,
  })
  expect(highlight).toEqual(['e-child'])
})
