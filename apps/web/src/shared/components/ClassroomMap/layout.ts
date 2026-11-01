export interface LayoutInput { rows: number; cols: number; container: { w: number; h: number } }
export interface SeatPos { row: number; col: number; x: number; y: number }
export interface Layout { seatPositions: SeatPos[]; scale: number }

const PAD = 40
const PODIUM_H = 80

export function computeLayout({ rows, cols, container }: LayoutInput): Layout {
  const cellW = (container.w - PAD * 2) / cols
  const cellH = (container.h - PAD * 2 - PODIUM_H) / rows
  const seatPositions: SeatPos[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seatPositions.push({
        row: r + 1, col: c + 1,
        x: PAD + cellW * (c + 0.5),
        y: PAD + PODIUM_H + cellH * (r + 0.5),
      })
    }
  }
  return { seatPositions, scale: 1 }
}
