import { useState } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import HoverCard from './HoverCard'
import { computeLayout } from './layout'
import StudentSeat, { SEAT_RADIUS } from './StudentSeat'
import type { ClassroomMapProps } from './types'

export default function ClassroomMap({ seats, rows, cols, mode = 'daily', onSeatClick }: ClassroomMapProps) {
  const [hovered, setHovered] = useState<Seat | null>(null)
  const mini = mode === 'mini'
  const L = computeLayout(rows, cols, { decor: !mini, frontWall: !mini })
  const scale = mini ? 0.5 : 1
  const cells = Array.from({ length: rows * cols }, (_, i) => {
    const row = Math.floor(i / cols) + 1, col = (i % cols) + 1
    return { row, col, ...L.head(row, col) }
  })

  const byCell = new Map<string, Seat>()
  for (const s of seats) {
    if (s.seat_row == null || s.seat_col == null) continue
    if (s.seat_row < 1 || s.seat_row > rows || s.seat_col < 1 || s.seat_col > cols) continue
    byCell.set(`${s.seat_row}:${s.seat_col}`, s)
  }
  const hoveredPos = hovered ? L.head(hovered.seat_row!, hovered.seat_col!) : undefined

  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="h-auto w-full" aria-label="教室座位图">
      <rect x={L.width / 2 - 80} y={L.grid.y - 40} width={160} height={32} rx={8} className="fill-fill stroke-line-2" />
      <text x={L.width / 2} y={L.grid.y - 24} textAnchor="middle" dominantBaseline="central" fontSize={14} className="fill-ink-2">
        讲 台
      </text>
      {cells.map((p) => (
        <StudentSeat
          key={`${p.row}:${p.col}`}
          seat={byCell.get(`${p.row}:${p.col}`) ?? null}
          x={p.x}
          y={p.y}
          scale={scale}
          onClick={onSeatClick}
          onHover={setHovered}
        />
      ))}
      {hovered && hoveredPos && (
        <HoverCard seat={hovered} x={hoveredPos.x + SEAT_RADIUS * scale + 24} y={hoveredPos.y} />
      )}
    </svg>
  )
}
