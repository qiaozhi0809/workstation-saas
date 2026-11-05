import { memo } from 'react'
import Desk, { ChairBack, ChairSeat } from './art/Desk'
import { GRADE_TINTS, SHADOW } from './art/palette'
import type { Layout } from './layout'
import type { MapCell } from './SeatLayer'
import type { SeatView } from './types'

// 单张桌椅只吃原始类型 props:views 换了新对象但这张桌子的颜色没变时不重画(与 SeatLayer 的逐格比较同理)
const DeskCell = memo(function DeskCell({
  x,
  y,
  seed,
  top,
}: {
  x: number
  y: number
  seed?: string
  top?: string
}) {
  return (
    <g>
      <Desk x={x} y={y} seed={seed} top={top} />
      <ChairSeat x={x} y={y} />
      <ChairBack x={x} y={y} />
    </g>
  )
})

// 全部桌椅放进一个挂投影的组,只算一次滤镜。椅背在有人的座位上会由 SeatLayer 再画一遍(无滤镜)压住衣摆
export default memo(function DeskLayer({
  layout,
  cells,
  views,
}: {
  layout: Layout
  cells: MapCell[]
  views?: Record<string, SeatView>
}) {
  return (
    <g className="cr-desks" filter={SHADOW}>
      {cells.map(({ row, col, seat }) => {
        const { x, y } = layout.seat(row, col)
        const tint = seat ? views?.[seat.enrollment_id]?.tint : undefined
        return (
          <DeskCell
            key={`${row}-${col}`}
            x={x}
            y={y}
            seed={seat?.enrollment_id}
            top={tint ? GRADE_TINTS[tint] : undefined}
          />
        )
      })}
    </g>
  )
})
