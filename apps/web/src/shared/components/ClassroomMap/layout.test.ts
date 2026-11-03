import { SCENE_ASPECT, computeLayout, M, type Layout, type Rect } from './layout'
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
  const L = computeLayout(1, 5)
  expect([1, 2, 3, 4, 5].map((c) => L.group(1, c))).toEqual([0, 0, 1, 1, 2])
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

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const contains = (o: Rect, i: Rect) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h
const seatRect = (L: Layout, r: number, c: number): Rect => ({ ...L.seat(r, c), w: M.DESK_W, h: M.SEAT_BOTTOM })
// 函数字段每次新建,按数据与取样结果比较
const plain = (L: Layout) => ({
  ...L, seat: undefined, head: undefined, label: undefined, group: undefined,
  seats: L.cells.map((c) => [L.seat(c.row, c.col), L.head(c.row, c.col), L.label(c.row, c.col), L.group(c.row, c.col)]),
})

it('keeps the double-desk layout unchanged by default', () => {
  expect(plain(computeLayout(6, 4))).toEqual(plain(computeLayout(6, 4, { deskSize: 2, podium: { left: 0, right: 0 } })))
})
it('groups three seats per desk with an aisle between desks', () => {
  const L = computeLayout(4, 9, { deskSize: 3 })
  expect(L.seat(1, 2).x - L.seat(1, 1).x).toBe(M.DESK_W)
  expect(L.seat(1, 4).x - L.seat(1, 3).x).toBe(M.DESK_W + M.AISLE)
})
it('uses a narrow aisle between single desks', () => {
  const L = computeLayout(4, 4, { deskSize: 1 })
  expect(L.seat(1, 2).x - L.seat(1, 1).x).toBe(M.DESK_W + M.AISLE_SINGLE)
})
it('places podium seats beside the lectern, inside the core, clear of the side zones', () => {
  const L = computeLayout(4, 2, { deskSize: 1, podium: { left: 2, right: 2 } })
  const cx = L.width / 2
  expect(L.seat(0, -1).x + M.DESK_W).toBe(cx - 120 - M.POD_GAP)
  expect(L.seat(0, -1).x - L.seat(0, -2).x).toBe(M.DESK_W + M.POD_SEP)
  expect(L.seat(0, 1).x).toBe(cx + 120 + M.POD_GAP)
  for (const z of L.zones) for (const c of [-2, -1, 1, 2]) expect(overlaps(z.rect, seatRect(L, 0, c))).toBe(false)
  expect(contains(L.core, seatRect(L, 0, -2))).toBe(true)
  expect(L.cells.slice(0, 4)).toEqual([{ row: 0, col: -2 }, { row: 0, col: -1 }, { row: 0, col: 1 }, { row: 0, col: 2 }])
})
it('keeps podium seats a clear step off the front wall and inside the platform', () => {
  const L = computeLayout(4, 4, { podium: { left: 1, right: 1 } })
  expect(L.seat(0, -1).y - L.podium!.y).toBeGreaterThanOrEqual(16)
  expect(L.seat(0, -1).y + M.SEAT_BOTTOM).toBeLessThanOrEqual(L.podium!.y + L.podium!.h)
})
it('podium seats do not straddle the platform front edge', () => {
  for (const opts of [{ left: 1, right: 1 }, { left: 2, right: 2 }]) {
    const L = computeLayout(4, 4, { deskSize: 1, podium: opts })
    const edge = L.podium!.y + L.podium!.h - M.POD_EDGE
    for (const c of L.cells.filter((x) => x.row === 0)) {
      const r = seatRect(L, 0, c.col)
      expect(r.y + r.h).toBeLessThanOrEqual(edge)
    }
  }
})
it('draws podium seats in a strip above the grid without a front wall', () => {
  const L = computeLayout(4, 4, { decor: false, frontWall: false, podium: { left: 1, right: 0 } })
  expect(L.seat(0, -1).y).toBeLessThan(L.grid.y)
})
it('widens the podium platform to hold the side seats and exposes the group of podium seats', () => {
  const L = computeLayout(4, 8, { podium: { left: 1, right: 2 } })
  expect(L.podium!.w).toBe(240 + 2 * (M.POD_GAP + 2 * M.DESK_W + M.POD_SEP + 24))
  expect(L.podium!.x + L.podium!.w / 2).toBe(L.width / 2)
  expect(contains(L.podiumSeats!, seatRect(L, 0, 2))).toBe(true)
  expect(computeLayout(4, 8).podiumSeats).toBeNull()
  expect(L.group(0, -1)).toBe(0)
  expect(L.group(0, 1)).toBe(3)
})
