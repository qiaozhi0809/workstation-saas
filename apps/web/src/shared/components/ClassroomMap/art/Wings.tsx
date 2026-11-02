import { memo, useId } from 'react'
import type { AttendanceBoardData } from '../types'
import { WING_MIN, type Layout, type Rect, type Wing } from '../layout'
import { ROOM } from './palette'
import { CleaningCorner, HonorWall, SKIRT, WindowLight, WindowRow } from './wingArt'

// 清洁角的尺寸,放在右翼地板右下角,距右、下边各 24
const CORNER = { w: 216, h: 276 }, CORNER_PAD = 24

// 两翼:把前墙的底色和踢脚线补齐到场景两端;左翼墙上一排窗、地上对应的光斑;
// 右翼够宽(≥ WING_MIN,和陈设区搬家同一道门槛)时墙上荣誉墙、地板右下角清洁角(陈设用本地坐标,先平移到区域左上角)
function WingView({ side, wing, id, board }: { side: 'left' | 'right'; wing: Wing; id: string; board?: AttendanceBoardData }) {
  const { wall, floor } = wing
  const rect = (r: Rect) => <rect x={r.x} y={r.y} width={r.w} height={r.h} />
  const wide = side === 'right' && wall.w >= WING_MIN
  const corner = wide && floor.w >= CORNER.w + CORNER_PAD && floor.h >= CORNER.h + CORNER_PAD
  return (
    <g data-wing={side}>
      <clipPath id={`${id}-wall`}>{rect(wall)}</clipPath>
      <clipPath id={`${id}-floor`}>{rect(floor)}</clipPath>
      <g clipPath={`url(#${id}-wall)`}>
        <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} fill={ROOM.wall} />
        <rect x={wall.x} y={wall.y + wall.h - SKIRT} width={wall.w} height={SKIRT} fill={ROOM.trim} />
        <path d={`M ${wall.x} ${wall.y + wall.h - SKIRT} L ${wall.x + wall.w} ${wall.y + wall.h - SKIRT}`}
          stroke={ROOM.desk} strokeWidth={3} />
        {side === 'left' && (
          <g transform={`translate(${wall.x} ${wall.y})`}><WindowRow w={wall.w} h={wall.h} board={board} /></g>
        )}
        {wide && (
          <g transform={`translate(${wall.x} ${wall.y})`}><HonorWall w={wall.w} h={wall.h} /></g>
        )}
      </g>
      <g clipPath={`url(#${id}-floor)`}>
        {side === 'left' && (
          <g transform={`translate(${floor.x} ${floor.y})`}><WindowLight w={floor.w} h={floor.h} board={!!board} /></g>
        )}
        {corner && (
          <g transform={`translate(${floor.x + floor.w - CORNER_PAD - CORNER.w} ${floor.y + floor.h - CORNER_PAD - CORNER.h})`}>
            <CleaningCorner w={CORNER.w} h={CORNER.h} />
          </g>
        )}
      </g>
    </g>
  )
}

export default memo(function Wings({ layout, attendanceBoard }: { layout: Layout; attendanceBoard?: AttendanceBoardData }) {
  const id = `cr-wing-${useId().replace(/:/g, '')}`
  if (!layout.wings) return null
  return (
    <g className="cr-wings" aria-hidden="true">
      <WingView side="left" wing={layout.wings.left} id={`${id}-l`} board={attendanceBoard} />
      <WingView side="right" wing={layout.wings.right} id={`${id}-r`} />
    </g>
  )
})
