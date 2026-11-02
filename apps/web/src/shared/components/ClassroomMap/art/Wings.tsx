import { memo, useId } from 'react'
import type { Layout, Rect, Wing } from '../layout'
import { ROOM } from './palette'

const SKIRT = 26

// 两翼:把前墙的底色和踢脚线补齐到场景两端,地板区先留空(陈设由后续任务填)
function WingView({ side, wing, id }: { side: 'left' | 'right'; wing: Wing; id: string }) {
  const { wall, floor } = wing
  const rect = (r: Rect) => <rect x={r.x} y={r.y} width={r.w} height={r.h} />
  return (
    <g data-wing={side}>
      <clipPath id={`${id}-wall`}>{rect(wall)}</clipPath>
      <clipPath id={`${id}-floor`}>{rect(floor)}</clipPath>
      <g clipPath={`url(#${id}-wall)`}>
        <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} fill={ROOM.wall} />
        <rect x={wall.x} y={wall.y + wall.h - SKIRT} width={wall.w} height={SKIRT} fill={ROOM.trim} />
        <path d={`M ${wall.x} ${wall.y + wall.h - SKIRT} L ${wall.x + wall.w} ${wall.y + wall.h - SKIRT}`}
          stroke={ROOM.desk} strokeWidth={3} />
      </g>
      <g clipPath={`url(#${id}-floor)`} />
    </g>
  )
}

export default memo(function Wings({ layout }: { layout: Layout }) {
  const id = `cr-wing-${useId().replace(/:/g, '')}`
  if (!layout.wings) return null
  return (
    <g className="cr-wings" aria-hidden="true">
      <WingView side="left" wing={layout.wings.left} id={`${id}-l`} />
      <WingView side="right" wing={layout.wings.right} id={`${id}-r`} />
    </g>
  )
})
