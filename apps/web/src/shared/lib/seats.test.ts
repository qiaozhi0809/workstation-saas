import { expect, it } from 'vitest'
import {
  colRange,
  gridCells,
  groupOf,
  gridOf,
  inGrid,
  isPodium,
  podiumCells,
  seatText,
} from './seats'

const g = { rows: 2, cols: 6, deskSize: 3, podiumLeft: 2, podiumRight: 1 } as const
it('lists podium cells left first then right', () => {
  expect(podiumCells(g)).toEqual([
    { row: 0, col: -1 },
    { row: 0, col: -2 },
    { row: 0, col: 1 },
  ])
})
it('names seats', () => {
  expect(seatText({ row: 2, col: 3 }, g)).toBe('2排3列')
  expect(seatText({ row: 0, col: -1 }, g)).toBe('讲台左边（靠讲桌）')
  expect(seatText({ row: 0, col: -2 }, g)).toBe('讲台左边（外侧）')
  expect(seatText({ row: 0, col: 1 }, g)).toBe('讲台右边')
})
it('groups by desk, single desks two columns per group, podium nearest group', () => {
  expect([1, 3, 4, 6].map((c) => groupOf(c, 3, 6))).toEqual([0, 0, 1, 1])
  expect([1, 2, 3].map((c) => groupOf(c, 1, 8))).toEqual([0, 0, 1])
  expect(groupOf(-1, 2, 8, 0)).toBe(0)
  expect(groupOf(1, 2, 8, 0)).toBe(3)
})
it('checks cells', () => {
  expect(inGrid(g, { row: 0, col: -2 })).toBe(true)
  expect(inGrid(g, { row: 0, col: 2 })).toBe(false)
  expect(inGrid(g, { row: 3, col: 1 })).toBe(false)
  expect(inGrid(g, { row: 2, col: 6 })).toBe(true)
  expect(inGrid(g, { row: 0, col: 0 })).toBe(false)
})
it('lists grid cells row-major', () => {
  expect(gridCells({ ...g, rows: 2, cols: 2 })).toEqual([
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 1 },
    { row: 2, col: 2 },
  ])
})
it('column ranges per desk size', () => {
  expect(colRange(1)).toEqual([2, 12])
  expect(colRange(2)).toEqual([2, 12])
  expect(colRange(3)).toEqual([3, 12])
})
it('builds grid from class and detects podium', () => {
  expect(
    gridOf({ seat_rows: 4, seat_cols: 6, desk_size: 2, podium_left: 1, podium_right: 0 }),
  ).toEqual({ rows: 4, cols: 6, deskSize: 2, podiumLeft: 1, podiumRight: 0 })
  expect(isPodium({ row: 0 })).toBe(true)
  expect(isPodium({ row: null })).toBe(false)
})
