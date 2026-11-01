import type { KeyboardEvent } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'

interface Props {
  seat: Seat | null
  x: number
  y: number
  scale: number
  onClick?: (seat: Seat) => void
  onHover?: (seat: Seat | null) => void
}

export const SEAT_RADIUS = 20

export default function StudentSeat({ seat, x, y, scale, onClick, onHover }: Props) {
  const r = SEAT_RADIUS * scale
  if (!seat) {
    return (
      <circle cx={x} cy={y} r={r} className="fill-none stroke-line-2" strokeDasharray="4 4" />
    )
  }
  const clickable = !!onClick
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.(seat)
    }
  }
  return (
    <g
      onMouseEnter={() => onHover?.(seat)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onClick?.(seat)}
      className={clickable ? 'cursor-pointer' : undefined}
      {...(clickable
        ? { role: 'button', tabIndex: 0, 'aria-label': seat.name, onKeyDown }
        : {})}
    >
      <circle cx={x} cy={y} r={r} className="fill-blue-soft stroke-blue" strokeWidth={1.5} />
      <text
        x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fontSize={16 * scale} className="fill-blue"
      >
        {Array.from(seat.name)[0]}
      </text>
      <text
        x={x} y={y + r + 14 * scale} textAnchor="middle"
        fontSize={12 * scale} className="fill-ink"
      >
        {seat.name}
      </text>
    </g>
  )
}
