import { computeLayout, groupOf, M } from './layout'

it('keeps a fixed row pitch for 9 rows so names never overlap the row above', () => {
  const L = computeLayout(9, 6)
  for (let r = 1; r < 9; r++) {
    expect(L.head(r + 1, 1).y - L.head(r, 1).y).toBe(M.ROW)
    expect(L.label(r + 1, 1).y - 14).toBeGreaterThan(L.head(r, 1).y + M.FIGURE_BOTTOM)
  }
  expect(L.height).toBe(2 * M.WALL + M.FRONT + M.PODIUM + M.TOP_PAD + 9 * M.ROW + M.BACK)
})

it('pairs desks and puts an aisle between pairs', () => {
  const L = computeLayout(2, 4)
  expect(L.seat(1, 2).x - L.seat(1, 1).x).toBe(M.DESK_W)
  expect(L.seat(1, 3).x - L.seat(1, 2).x).toBe(M.DESK_W + M.AISLE)
})

it('handles an odd column count', () => {
  const L = computeLayout(2, 5)
  expect(L.grid.w).toBe(3 * 2 * M.DESK_W + 2 * M.AISLE)
  expect(L.width).toBe(2 * M.WALL + 2 * M.SIDE + L.grid.w)
})

it('fits decor zones to the available height', () => {
  expect(computeLayout(2, 4).zones.map((z) => z.id)).toEqual(['reading', 'honor', 'homework', 'nature'])
  expect(computeLayout(8, 4).zones).toHaveLength(7)
})

it('drops decor, front wall and podium for the mini map', () => {
  const L = computeLayout(2, 4, { decor: false, frontWall: false })
  expect(L.zones).toEqual([])
  expect(L.frontWall).toBeNull()
  expect(L.podium).toBeNull()
  expect(L.grid.x).toBe(M.WALL + M.SIDE_BARE)
})

it('maps columns to desk-pair groups', () => {
  expect([1, 2, 3, 4, 5].map(groupOf)).toEqual([0, 0, 1, 1, 2])
})
