import { SCENE_ASPECT, computeLayout, groupOf, M } from './layout'
import { CELL } from './seatParts'

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
  const readingX = (l: typeof L) => l.zones.find((z) => z.id === 'reading')!.rect.x
  expect(readingX(L)).toBe(readingX(core) + 669)
  expect(L.podium!.x + L.podium!.w / 2).toBe(L.width / 2)
  expect(L.wings!.left.wall).toEqual({ x: M.WALL, y: M.WALL, w: 669, h: M.FRONT })
  expect(L.wings!.left.wall.x + L.wings!.left.wall.w).toBe(L.frontWall!.x)
  expect(L.wings!.right.wall.x).toBe(L.frontWall!.x + L.frontWall!.w)
  expect(L.wings!.right.floor.x + L.wings!.right.floor.w).toBe(L.width - M.WALL)
  expect(L.wings!.left.floor).toEqual({ x: M.WALL, y: M.WALL + M.FRONT, w: 669, h: L.height - 2 * M.WALL - M.FRONT })
})

it('moves honor and cleaning out to the wings when they are wide enough', () => {
  expect(computeLayout(6, 4, { aspect: SCENE_ASPECT }).zones.map((z) => z.id))
    .toEqual(['reading', 'talk', 'homework', 'nature', 'sports'])
  expect(computeLayout(4, 8, { aspect: SCENE_ASPECT }).zones.map((z) => z.id))
    .toEqual(computeLayout(4, 8).zones.map((z) => z.id))
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

it('marks the core: front wall top to just below the last row of seats, across the safe area', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const bottom = L.seat(6, 1).y + M.SEAT_BOTTOM + M.CORE_PAD
  expect(L.core).toEqual({ x: L.safe.x, y: M.WALL, w: L.safe.w, h: bottom - M.WALL })
  expect(L.core.h).toBe(1138)
  // 核心包住前墙、讲台和最后一排(整格热区、人物、椅背)
  expect(L.core.y).toBeLessThanOrEqual(L.frontWall!.y)
  expect(L.core.y + L.core.h).toBeGreaterThan(L.podium!.y + L.podium!.h)
  expect(CELL.y + CELL.h).toBe(M.SEAT_BOTTOM)
  expect(L.head(6, 1).y - L.seat(6, 1).y + M.FIGURE_BOTTOM).toBeLessThanOrEqual(M.SEAT_BOTTOM)
  expect(L.core.y + L.core.h).toBeLessThan(L.height - M.WALL)
  // 后部地板与储物柜在核心之外
  expect(L.height - (L.core.y + L.core.h)).toBeGreaterThan(M.BACK)
})

it('treats the whole scene as core when there is no front wall (mini map)', () => {
  const L = computeLayout(2, 4, { decor: false, frontWall: false })
  expect(L.core).toEqual({ x: 0, y: 0, w: L.width, h: L.height })
})
