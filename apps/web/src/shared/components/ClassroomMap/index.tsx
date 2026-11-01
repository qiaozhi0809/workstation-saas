import { useState } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import HoverCard from './HoverCard'
import { computeLayout } from './layout'
import StudentSeat, { SEAT_RADIUS } from './StudentSeat'
import type { ClassroomMapProps } from './types'

const CANVAS = { w: 800, h: 500 }

export default function ClassroomMap({ seats, rows, cols, mode = 'daily', onSeatClick }: ClassroomMapProps) {
  const [hovered, setHovered] = useState<Seat | null>(null)
  const { seatPositions } = computeLayout({ rows, cols, container: CANVAS })
  const scale = mode === 'mini' ? 0.5 : 1

  const byCell = new Map<string, Seat>()
  for (const s of seats) {
    if (s.seat_row == null || s.seat_col == null) continue
    if (s.seat_row < 1 || s.seat_row > rows || s.seat_col < 1 || s.seat_col > cols) continue
    byCell.set(`${s.seat_row}:${s.seat_col}`, s)
  }
  const hoveredPos = hovered
    ? seatPositions.find((p) => p.row === hovered.seat_row && p.col === hovered.seat_col)
    : undefined

  return (
    <svg viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} className="h-auto w-full" aria-label="教室座位图">
      <rect x={320} y={20} width={160} height={48} rx={8} className="fill-fill stroke-line-2" />
      <text x={400} y={44} textAnchor="middle" dominantBaseline="central" fontSize={14} className="fill-ink-2">
        讲 台
      </text>
      {seatPositions.map((p) => (
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
