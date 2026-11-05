import type { ClassView } from '@/shared/types/class'
import type { DeskSize } from '@/shared/types/seating'

export interface DeskGrid {
  rows: number
  cols: number
  deskSize: DeskSize
  podiumLeft: number
  podiumRight: number
}
export interface SeatCell {
  row: number
  col: number
}

export const DESK_TYPES: { n: DeskSize; label: string }[] = [
  { n: 1, label: '单人单列' },
  { n: 2, label: '双人同桌' },
  { n: 3, label: '三人一排' },
]

export function gridOf(
  cls: Pick<ClassView, 'seat_rows' | 'seat_cols' | 'desk_size' | 'podium_left' | 'podium_right'>,
): DeskGrid {
  return {
    rows: cls.seat_rows,
    cols: cls.seat_cols,
    deskSize: cls.desk_size,
    podiumLeft: cls.podium_left,
    podiumRight: cls.podium_right,
  }
}

export function colRange(desk: DeskSize): [number, number] {
  return desk === 3 ? [3, 12] : [2, 12]
}

export function isPodium(cell: { row: number | null }): boolean {
  return cell.row === 0
}

export function podiumCells(g: DeskGrid): SeatCell[] {
  const cells: SeatCell[] = []
  for (let i = 1; i <= g.podiumLeft; i++) cells.push({ row: 0, col: -i })
  for (let i = 1; i <= g.podiumRight; i++) cells.push({ row: 0, col: i })
  return cells
}

export function gridCells(g: DeskGrid): SeatCell[] {
  const cells: SeatCell[] = []
  for (let r = 1; r <= g.rows; r++) for (let c = 1; c <= g.cols; c++) cells.push({ row: r, col: c })
  return cells
}

export function inGrid(g: DeskGrid, cell: SeatCell): boolean {
  if (cell.row === 0) {
    const side = cell.col < 0 ? g.podiumLeft : g.podiumRight
    const n = Math.abs(cell.col)
    return cell.col !== 0 && n <= 2 && n <= side
  }
  return cell.row >= 1 && cell.row <= g.rows && cell.col >= 1 && cell.col <= g.cols
}

export function seatText(cell: SeatCell, g: DeskGrid): string {
  if (cell.row !== 0) return `${cell.row}排${cell.col}列`
  const left = cell.col < 0
  const side = left ? g.podiumLeft : g.podiumRight
  const base = left ? '讲台左边' : '讲台右边'
  if (side <= 1) return base
  return `${base}${Math.abs(cell.col) === 1 ? '（靠讲桌）' : '（外侧）'}`
}

export function groupOf(col: number, deskSize: DeskSize, cols: number, row?: number): number {
  const span = deskSize === 1 ? 2 : deskSize
  if (row === 0 && col < 0) return 0
  if (row === 0 && col > 0) return Math.floor((cols - 1) / span)
  return Math.floor((col - 1) / span)
}
