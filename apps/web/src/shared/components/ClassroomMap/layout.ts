export const M = {
  WALL: 16, FRONT: 220, PODIUM: 128, TOP_PAD: 24, DESK_W: 84, DESK_D: 40, AISLE: 72, ROW: 128,
  BACK: 120, SIDE: 260, SIDE_BARE: 48, HEAD_R: 17, FIGURE_BOTTOM: 52, ZONE_GAP: 16,
} as const

export interface Rect { x: number; y: number; w: number; h: number }
export type ZoneId = 'reading' | 'honor' | 'cleaning' | 'homework' | 'nature' | 'sports' | 'talk'
export const ZONE_MIN_H: Record<ZoneId, number> = {
  reading: 260, honor: 180, cleaning: 150, homework: 200, nature: 200, sports: 150, talk: 200,
}
interface Pt { x: number; y: number }
export const SCENE_ASPECT = 16 / 9
export interface Wing { wall: Rect; floor: Rect }
export interface Layout {
  width: number; height: number; grid: Rect
  safe: Rect; wings: { left: Wing; right: Wing } | null
  frontWall: Rect | null; podium: Rect | null
  zones: { id: ZoneId; rect: Rect }[]
  seat(row: number, col: number): Pt
  head(row: number, col: number): Pt
  label(row: number, col: number): Pt
}

const LEFT: ZoneId[] = ['reading', 'honor', 'cleaning']
const RIGHT: ZoneId[] = ['homework', 'nature', 'sports', 'talk']
const PODIUM_W = 240

export const groupOf = (col: number) => (col - 1) >> 1

export function computeLayout(
  rows: number, cols: number, opts: { decor?: boolean; frontWall?: boolean; aspect?: number } = {},
): Layout {
  const { decor = true, frontWall = true, aspect } = opts
  const pairs = Math.ceil(cols / 2)
  const side = decor ? M.SIDE : M.SIDE_BARE
  const front = frontWall ? M.FRONT + M.PODIUM : 0
  const coreW = 2 * M.WALL + 2 * side + pairs * 2 * M.DESK_W + (pairs - 1) * M.AISLE
  const height = 2 * M.WALL + front + M.TOP_PAD + rows * M.ROW + M.BACK
  // 核心教室照旧在核心坐标里算,再整体右移 dx;两翼只在 dx > 0 时存在
  const dx = aspect ? Math.ceil(Math.max(0, height * aspect - coreW) / 2) : 0
  const width = coreW + 2 * dx
  const grid: Rect = {
    x: M.WALL + side + dx, y: M.WALL + front + M.TOP_PAD,
    w: pairs * 2 * M.DESK_W + (pairs - 1) * M.AISLE, h: rows * M.ROW,
  }

  const seat = (r: number, c: number) => ({
    x: grid.x + Math.floor((c - 1) / 2) * (2 * M.DESK_W + M.AISLE) + ((c - 1) % 2) * M.DESK_W,
    y: grid.y + (r - 1) * M.ROW,
  })

  const zones: Layout['zones'] = []
  if (decor) {
    const avail = height - 2 * M.WALL - (frontWall ? M.FRONT : 0)
    const top = M.WALL + (frontWall ? M.FRONT : 0)
    const w = side - 24
    const stack = (ids: ZoneId[], x: number) => {
      let y = top, used = 0
      for (const id of ids) {
        const h = ZONE_MIN_H[id]
        const need = used + (used ? M.ZONE_GAP : 0) + h
        if (need > avail) break
        y = top + used + (used ? M.ZONE_GAP : 0)
        zones.push({ id, rect: { x, y, w, h } })
        used = need
      }
    }
    stack(LEFT, M.WALL + 12 + dx)
    stack(RIGHT, width - M.WALL - side + 12 - dx)
  }

  const wingH = height - 2 * M.WALL - M.FRONT
  const wings: Layout['wings'] = dx > 0 ? {
    left: {
      wall: { x: M.WALL, y: M.WALL, w: dx, h: M.FRONT },
      floor: { x: M.WALL, y: M.WALL + M.FRONT, w: dx, h: wingH },
    },
    right: {
      wall: { x: dx + coreW - M.WALL, y: M.WALL, w: dx, h: M.FRONT },
      floor: { x: dx + coreW - M.WALL, y: M.WALL + M.FRONT, w: dx, h: wingH },
    },
  } : null

  return {
    width, height, grid, zones, wings,
    safe: { x: dx, y: 0, w: coreW, h: height },
    frontWall: frontWall ? { x: M.WALL + dx, y: M.WALL, w: coreW - 2 * M.WALL, h: M.FRONT } : null,
    podium: frontWall ? { x: (width - PODIUM_W) / 2, y: M.WALL + M.FRONT, w: PODIUM_W, h: M.PODIUM } : null,
    seat,
    head: (r, c) => { const s = seat(r, c); return { x: s.x + M.DESK_W / 2, y: s.y + M.DESK_D + 8 } },
    label: (r, c) => { const s = seat(r, c); return { x: s.x + M.DESK_W / 2, y: s.y - 6 } },
  }
}
