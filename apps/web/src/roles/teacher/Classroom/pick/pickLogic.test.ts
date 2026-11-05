import { choosePick, cooldownSize, pickPool, spinDelays } from './pickLogic'

const s = (id: string, row: number | null = 1) => ({
  enrollment_id: id,
  seat_row: row,
  seat_col: row,
})
const status: Record<string, 'leave' | 'absent' | 'late'> = { b: 'leave', c: 'absent', d: 'late' }

it('pools seated students who are not on leave or absent', () => {
  expect(pickPool([s('a'), s('b'), s('c'), s('d'), s('e', null)], (id) => status[id])).toEqual([
    'a',
    'd',
  ])
})

it('pickPool is empty when everyone is on leave', () => {
  expect(pickPool([s('a'), s('b')], () => 'leave')).toEqual([])
  expect(choosePick([], [], () => 0)).toEqual({ id: null, recent: [] })
})

it('avoids recent picks and resets when all were picked', () => {
  expect(choosePick(['a', 'b', 'c'], ['a'], () => 0)).toEqual({ id: 'b', recent: ['a', 'b'] })
  expect(choosePick(['a', 'b'], ['a', 'b'], () => 0.99).id).toBe('b')
})

it('choosePick allows repeats when the pool has one student', () => {
  expect(cooldownSize(1)).toBe(0)
  expect(choosePick(['a'], [], () => 0)).toEqual({ id: 'a', recent: [] })
  expect(choosePick(['a'], [], () => 0).id).toBe('a')
})

it('caps the cooldown at 8', () => {
  const pool = Array.from({ length: 20 }, (_, i) => `p${i}`)
  let recent: string[] = []
  for (let i = 0; i < 12; i++) recent = choosePick(pool, recent, () => 0).recent
  expect(recent).toHaveLength(8)
})

it('slows the spin down', () => {
  const d = spinDelays()
  expect(d).toHaveLength(16)
  expect(d[0]).toBe(60)
  expect(d.every((x, i) => i === 0 || x > d[i - 1])).toBe(true)
})
