import { memo } from 'react'
import type { Layout, ZoneId } from '../layout'
import { MUTED } from './kit'
import ZoneArt from './zoneArt'

// eslint-disable-next-line react-refresh/only-export-components
export const ZONE_LABEL: Record<ZoneId, string> = {
  reading: '阅读角',
  honor: '荣誉墙',
  cleaning: '清洁角',
  homework: '作业架',
  nature: '自然角',
  sports: '运动器材',
  talk: '谈心角',
}

// 两侧陈设区:布局已决定放哪些;每区内容 + 底部浅色标签
export default memo(function Zones({ zones }: { zones: Layout['zones'] }) {
  return (
    <g className="cr-zones">
      {zones.map(({ id, rect }) => (
        <g key={id} data-zone={id} transform={`translate(${rect.x} ${rect.y})`}>
          <ZoneArt id={id} w={rect.w} h={rect.h} />
          <text
            x={rect.w / 2}
            y={rect.h - 8}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            letterSpacing={2}
            fill={MUTED}
            opacity={0.75}
          >
            {ZONE_LABEL[id]}
          </text>
        </g>
      ))}
    </g>
  )
})
