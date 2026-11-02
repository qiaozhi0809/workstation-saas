import { memo } from 'react'
import Desk, { ChairBack, ChairSeat } from './art/Desk'
import { GRADE_TINTS, SHADOW } from './art/palette'
import type { Layout } from './layout'
import type { MapCell } from './SeatLayer'
import type { SeatView } from './types'

// 全部桌椅放进一个挂投影的组,只算一次滤镜。椅背在有人的座位上会由 SeatLayer 再画一遍(无滤镜)压住衣摆
export default memo(function DeskLayer({ layout, cells, views }: { layout: Layout; cells: MapCell[]; views?: Record<string, SeatView> }) {
  return (
    <g className="cr-desks" filter={SHADOW}>
      {cells.map(({ row, col, seat }) => {
        const { x, y } = layout.seat(row, col)
        return (
          <g key={`${row}-${col}`}>
            <Desk x={x} y={y} seed={seat?.enrollment_id}
              top={seat && views?.[seat.enrollment_id]?.tint ? GRADE_TINTS[views[seat.enrollment_id].tint!] : undefined} />
            <ChairSeat x={x} y={y} />
            <ChairBack x={x} y={y} />
          </g>
        )
      })}
    </g>
  )
})
