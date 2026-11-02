import { SCENE_ASPECT, computeLayout, groupOf, M } from './layout'

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

it('widens to the aspect with symmetric wings and keeps the core unchanged inside the safe area', () => {
  const core = computeLayout(6, 4)
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  expect(L.width).toBe(2298)
  expect(L.height).toBe(core.height)
  expect(L.safe).toEqual({ x: 669, y: 0, w: core.width, h: core.height })
  expect(L.seat(3, 2)).toEqual({ x: core.seat(3, 2).x + 669, y: core.seat(3, 2).y })
  expect(L.frontWall).toEqual({ ...core.frontWall!, x: core.frontWall!.x + 669 })
  expect(L.zones.map((z) => [z.id, z.rect.x])).toEqual(core.zones.map((z) => [z.id, z.rect.x + 669]))
  expect(L.podium!.x + L.podium!.w / 2).toBe(L.width / 2)
  expect(L.wings!.left.wall).toEqual({ x: M.WALL, y: M.WALL, w: 669, h: M.FRONT })
  expect(L.wings!.left.wall.x + L.wings!.left.wall.w).toBe(L.frontWall!.x)
  expect(L.wings!.right.wall.x).toBe(L.frontWall!.x + L.frontWall!.w)
  expect(L.wings!.right.floor.x + L.wings!.right.floor.w).toBe(L.width - M.WALL)
  expect(L.wings!.left.floor).toEqual({ x: M.WALL, y: M.WALL + M.FRONT, w: 669, h: L.height - 2 * M.WALL - M.FRONT })
})

it('does not widen a room that is already wider than the aspect', () => {
  const L = computeLayout(2, 12, { aspect: SCENE_ASPECT })
  expect(L.width).toBe(computeLayout(2, 12).width)
  expect(L.wings).toBeNull()
  expect(L.safe.x).toBe(0)
})

it('treats the whole room as safe without an aspect, and never widens the mini map', () => {
  const L = computeLayout(6, 4)
  expect(L.safe).toEqual({ x: 0, y: 0, w: L.width, h: L.height })
  expect(L.wings).toBeNull()
})
