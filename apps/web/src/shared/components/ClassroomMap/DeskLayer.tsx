import Desk, { ChairBack, ChairSeat } from './art/Desk'
import { SHADOW } from './art/palette'
import type { Layout } from './layout'
import type { MapCell } from './SeatLayer'

// 全部桌椅放进一个挂投影的组,只算一次滤镜。椅背在有人的座位上会由 SeatLayer 再画一遍(无滤镜)压住衣摆
export default function DeskLayer({ layout, cells }: { layout: Layout; cells: MapCell[] }) {
  return (
    <g className="cr-desks" filter={SHADOW}>
      {cells.map(({ row, col, seat }) => {
        const { x, y } = layout.seat(row, col)
        return (
          <g key={`${row}-${col}`}>
            <Desk x={x} y={y} seed={seat?.enrollment_id} />
            <ChairSeat x={x} y={y} />
            <ChairBack x={x} y={y} />
          </g>
        )
      })}
    </g>
  )
}
