import { INK, ROOM, mix } from '../art/palette'

const WARM = mix(ROOM.gold, INK.outline, 0.25)

// 点名聚光灯:座位地面上的暖黄光斑;位置走 CSS transform,换人时 120ms 平移过去
export default function Spotlight({ at }: { at: { x: number; y: number } | null }) {
  if (!at) return null
  return (
    <g className="cr-anim" pointerEvents="none">
      <g className="cr-spotlight" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
        <ellipse cy={24} rx={62} ry={50} fill={WARM} opacity={0.16} />
        <ellipse cy={28} rx={46} ry={36} fill={WARM} opacity={0.22} />
      </g>
    </g>
  )
}
