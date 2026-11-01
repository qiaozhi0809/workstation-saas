import type { StudentSeat } from '@/shared/types/student'

interface Props {
  seat: StudentSeat
  x: number
  y: number
}

const W = 120
const H = 48

export default function HoverCard({ seat, x, y }: Props) {
  return (
    <g transform={`translate(${x}, ${y - H / 2})`} pointerEvents="none">
      <rect width={W} height={H} rx={8} className="fill-panel stroke-line-2" />
      <text x={12} y={20} fontSize={13} className="fill-ink">{seat.name}</text>
      <text x={12} y={37} fontSize={11} className="fill-ink-2">{`编号 ${seat.mk}`}</text>
    </g>
  )
}
