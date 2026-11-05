import type { StudentSeat } from '@/shared/types/student'
import { INK } from '../art/palette'
import type { Layout } from '../layout'
import { M } from '../layout'
import type { FloatFx } from '../types'

// 五角星,外径 r
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5,
    r = i % 2 ? 3.4 : 8
  return `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`
}).join(' L ')

// 积分气泡:星形 + 文字,从课桌升起 40px 并淡出(动画在 classroom.css 的 .cr-float)
export default function Floats({
  items,
  layout,
  seats,
}: {
  items: FloatFx[]
  layout: Layout
  seats: StudentSeat[]
}) {
  if (!items.length) return null
  const byId = new Map(seats.map((s) => [s.enrollment_id, s]))
  return (
    <g className="cr-floats cr-anim" pointerEvents="none">
      {items.map((f) => {
        const s = byId.get(f.enrollmentId)
        if (!s || s.seat_row == null || s.seat_col == null) return null
        const p = layout.seat(s.seat_row, s.seat_col)
        return (
          <g key={f.key} transform={`translate(${p.x + M.DESK_W / 2} ${p.y + 8})`}>
            <g className={`cr-float ${f.tone === 'plus' ? 'cr-float-plus' : 'cr-float-minus'}`}>
              <circle cx={-14} r={11} fill={INK.outline} />
              <path
                d={`M ${STAR} Z`}
                transform="translate(-14 0)"
                fill="currentColor"
                stroke={INK.outline}
                strokeWidth={1}
                strokeLinejoin="round"
              />
              <text
                x={-1}
                y={6}
                fontSize={17}
                fontWeight={800}
                fill="currentColor"
                stroke={INK.outline}
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {f.text}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}
