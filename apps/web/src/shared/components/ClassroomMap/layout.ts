import { gridCells, groupOf, podiumCells, type DeskGrid } from '@/shared/lib/seats'
import type { DeskSize } from '@/shared/types/seating'

export const M = {
  WALL: 16, FRONT: 220, PODIUM: 128, TOP_PAD: 24, DESK_W: 84, DESK_D: 40, AISLE: 72, ROW: 128,
  BACK: 120, SIDE: 260, SIDE_BARE: 48, HEAD_R: 17, FIGURE_BOTTOM: 52, ZONE_GAP: 16,
  // 一个座位画到的最低处(相对座位左上角):整格热区 / 选中框下沿,椅背与人物都在它以上
  SEAT_BOTTOM: 102,
  // 核心下沿在最后一排座位下面再留的余量;它同时要盖住点名聚光灯的光斑(以头心为原点,椭圆下沿到座位 +122,
  // 即 SEAT_BOTTOM + 20),所以不能小于约 20
  CORE_PAD: 24,
  // 单人桌之间的过道;讲台两侧座位:离讲桌的间距、两张桌之间的间距、离地台上沿的距离
  // POD_EDGE:讲台地台画出的前沿(下面那条木边的下沿)比地台矩形下沿高多少(见 art/Podium.tsx:rect.y + rect.h - 20 起 10 高的木边)。
  // POD_Y:座位矩形(含名牌)上沿到地台上沿的距离;POD_Y + SEAT_BOTTOM ≤ PODIUM - POD_EDGE,座位整体落在前沿以内,不压住台面;
  // 名牌上沿(座位上方约 17)因此只比地台上沿高 1,落在前墙底边,不会碰到前墙内容
  AISLE_SINGLE: 40, POD_GAP: 30, POD_SEP: 14, POD_Y: 16, POD_EDGE: 10,
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
  // 核心:前墙顶到最后一排座位下沿 + 余量,横向 = 安全区。适应视图永远完整显示它,只有它上下之外(顶墙边距、后部地板)可被裁
  core: Rect
  frontWall: Rect | null; podium: Rect | null
  zones: { id: ZoneId; rect: Rect }[]
  // 讲台座位在前(左外、左内、右内、右外,即画面从左到右),再普通座位行优先;Tab 顺序随它
  cells: { row: number; col: number }[]
  deskGrid: DeskGrid
  // 讲台两侧座位占的外框;没有讲台座位时为 null
  podiumSeats: Rect | null
  group(row: number, col: number): number
  seat(row: number, col: number): Pt
  head(row: number, col: number): Pt
  label(row: number, col: number): Pt
}

const LEFT: ZoneId[] = ['reading', 'honor', 'cleaning']
const RIGHT: ZoneId[] = ['homework', 'nature', 'sports', 'talk']
// 两翼够宽时荣誉墙、清洁角搬到右翼去画,核心两侧只留其余陈设
export const WING_MIN = 280
const LEFT_WIDE: ZoneId[] = ['reading', 'talk']
const RIGHT_WIDE: ZoneId[] = ['homework', 'nature', 'sports']
const PODIUM_W = 240

export function computeLayout(
  rows: number, cols: number,
  opts: {
    decor?: boolean; frontWall?: boolean; aspect?: number
    deskSize?: DeskSize; podium?: { left: number; right: number }
  } = {},
): Layout {
  const { decor = true, frontWall = true, aspect, deskSize = 2, podium: pod = { left: 0, right: 0 } } = opts
  const k = deskSize
  const desks = Math.ceil(cols / k)
  const unit = k * M.DESK_W
  const aisle = k === 1 ? M.AISLE_SINGLE : M.AISLE
  const gridW = desks * unit + (desks - 1) * aisle
  const podN = Math.max(pod.left, pod.right)
  const hasPod = pod.left + pod.right > 0
  const podW = podN ? PODIUM_W + 2 * (M.POD_GAP + podN * M.DESK_W + (podN - 1) * M.POD_SEP + 24) : PODIUM_W
  const side = decor ? M.SIDE : M.SIDE_BARE
  const front = frontWall ? M.FRONT + M.PODIUM : 0
  // 没有前墙时,讲台座位画在网格上方的一条带里
  const strip = !frontWall && hasPod ? M.ROW : 0
  const baseW = 2 * M.WALL + 2 * side + gridW
  // 核心放不下讲台和两侧陈设时,差额平分加到网格两侧
  const need = hasPod ? podW + 2 * side + 2 * M.WALL : 0
  const pad = Math.ceil(Math.max(0, need - baseW) / 2)
  const coreW = baseW + 2 * pad
  const height = 2 * M.WALL + front + M.TOP_PAD + strip + rows * M.ROW + M.BACK
  // 核心教室照旧在核心坐标里算,再整体右移 dx;两翼只在 dx > 0 时存在
  const dx = aspect ? Math.ceil(Math.max(0, height * aspect - coreW) / 2) : 0
  const width = coreW + 2 * dx
  const grid: Rect = {
    x: M.WALL + side + pad + dx, y: M.WALL + front + M.TOP_PAD + strip,
    w: gridW, h: rows * M.ROW,
  }
  const cx = width / 2
  const podiumRect: Rect | null = frontWall ? { x: (width - podW) / 2, y: M.WALL + M.FRONT, w: podW, h: M.PODIUM } : null
  const podY = podiumRect ? podiumRect.y + M.POD_Y : M.WALL + M.TOP_PAD

  const seat = (r: number, c: number) => {
    if (r === 0) {
      const i = Math.abs(c)
      return c < 0
        ? { x: cx - PODIUM_W / 2 - M.POD_GAP - i * M.DESK_W - (i - 1) * M.POD_SEP, y: podY }
        : { x: cx + PODIUM_W / 2 + M.POD_GAP + (i - 1) * (M.DESK_W + M.POD_SEP), y: podY }
    }
    return {
      x: grid.x + Math.floor((c - 1) / k) * (unit + aisle) + ((c - 1) % k) * M.DESK_W,
      y: grid.y + (r - 1) * M.ROW,
    }
  }
  const deskGrid: DeskGrid = { rows, cols, deskSize: k, podiumLeft: pod.left, podiumRight: pod.right }
  const podCells = podiumCells(deskGrid)
  let podiumSeats: Rect | null = null
  if (podCells.length) {
    const xs = podCells.map((c) => seat(0, c.col).x)
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + M.DESK_W
    podiumSeats = { x: x0, y: podY, w: x1 - x0, h: M.SEAT_BOTTOM }
  }

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
    const wide = dx >= WING_MIN
    stack(wide ? LEFT_WIDE : LEFT, M.WALL + 12 + dx)
    stack(wide ? RIGHT_WIDE : RIGHT, width - M.WALL - side + 12 - dx)
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
    core: frontWall
      ? { x: dx, y: M.WALL, w: coreW, h: grid.y + (rows - 1) * M.ROW + M.SEAT_BOTTOM + M.CORE_PAD - M.WALL }
      : { x: dx, y: 0, w: coreW, h: height },
    frontWall: frontWall ? { x: M.WALL + dx, y: M.WALL, w: coreW - 2 * M.WALL, h: M.FRONT } : null,
    podium: podiumRect,
    cells: [...[...podCells].sort((a, b) => a.col - b.col), ...gridCells(deskGrid)], deskGrid, podiumSeats,
    group: (r, c) => groupOf(c, k, cols, r),
    seat,
    head: (r, c) => { const s = seat(r, c); return { x: s.x + M.DESK_W / 2, y: s.y + M.DESK_D + 8 } },
    label: (r, c) => { const s = seat(r, c); return { x: s.x + M.DESK_W / 2, y: s.y - 6 } },
  }
}
