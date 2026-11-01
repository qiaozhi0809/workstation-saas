import { memo } from 'react'
import { M, type Layout } from '../layout'
import { GROUP_COLORS, INK, ROOM, SHADOW } from './palette'
import { WOOD, WOOD_DARK, edge, shade, thin, tint } from './kit'

const W = M.WALL, LOCKER = 70

// 地板 + 侧墙 / 后墙:右墙一排窗(地面斜向光斑)、左墙前后两扇门、后墙储物柜
export default memo(function Room({ layout, rows }: { layout: Layout; rows: number }) {
  const { width, height, grid } = layout
  const top = layout.frontWall ? layout.frontWall.y + layout.frontWall.h : W
  const bottom = height - W, fw = width - 2 * W

  const seams: number[] = []
  for (let y = top + 32; y < bottom; y += 32) seams.push(y)

  const nWin = Math.max(3, rows - 1)
  const span = bottom - 70 - (top + 20), seg = span / nWin, wl = Math.min(96, seg * 0.72)
  const wins = Array.from({ length: nWin }, (_, i) => top + 20 + i * seg + (seg - wl) / 2)
  const xr = width - W, skew = Math.min(130, fw * 0.3)

  const doorL = 60
  const doors = [top + 24, bottom - doorL - 24]

  const nLock = Math.floor(grid.w / LOCKER)
  const lx = grid.x + (grid.w - nLock * LOCKER) / 2, ly = bottom - 48

  return (
    <g className="cr-room">
      <rect width={width} height={height} fill={ROOM.trim} />
      <rect x={W} y={top} width={fw} height={bottom - top} fill={ROOM.floor} />
      <g stroke={ROOM.plank} strokeWidth={1.5}>
        {seams.map((y) => <path key={y} d={`M ${W} ${y} L ${xr} ${y}`} />)}
      </g>
      <g fill={INK.outline} opacity={0.42}>
        {wins.map((wy) => (
          <path key={wy} d={`M ${xr} ${wy} L ${xr} ${wy + wl} L ${xr - skew} ${wy + wl + 44} L ${xr - skew} ${wy + 44} Z`} />
        ))}
      </g>
      <g filter={SHADOW}>
        {wins.map((wy) => (
          <g key={wy} className="cr-window">
            <rect x={xr - 3} y={wy - 4} width={W + 1} height={wl + 8} rx={2} fill={ROOM.desk} {...thin} />
            <rect x={xr + 1} y={wy} width={W - 6} height={wl} fill={ROOM.window} stroke={ROOM.desk} strokeWidth={1} />
            <path d={`M ${xr + 1} ${wy + wl / 2} L ${xr + W - 5} ${wy + wl / 2}`} stroke={ROOM.desk} strokeWidth={2} />
          </g>
        ))}
        {doors.map((dy, i) => (
          <g key={dy} className="cr-door" data-door={i ? 'back' : 'front'}>
            <rect x={2} y={dy} width={W + 6} height={doorL} rx={2} fill={WOOD} {...edge} />
            <rect x={6} y={dy + 6} width={W - 2} height={doorL / 2 - 9} rx={1.5} fill={tint(ROOM.window, 0.2)} stroke={WOOD_DARK} strokeWidth={1} />
            <circle cx={W + 3} cy={dy + doorL / 2 + 8} r={2.4} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1} />
          </g>
        ))}
      </g>
      <g filter={SHADOW}>
        {Array.from({ length: nLock }, (_, i) => {
          const x = lx + i * LOCKER + 2, c = GROUP_COLORS[i % GROUP_COLORS.length]
          return (
            <g key={i} className="cr-locker">
              <rect x={x} y={ly} width={LOCKER - 4} height={44} rx={3} fill={tint(c, 0.55)} {...edge} />
              <rect x={x} y={ly} width={LOCKER - 4} height={9} rx={3} fill={ROOM.desk} {...thin} />
              <path d={`M ${x + (LOCKER - 4) / 2} ${ly + 11} L ${x + (LOCKER - 4) / 2} ${ly + 42}`} stroke={shade(c, 0.05)} strokeWidth={1.2} />
              <rect x={x + 9} y={ly + 17} width={14} height={7} rx={1.5} fill={INK.outline} />
              <circle cx={x + (LOCKER - 4) / 2 - 5} cy={ly + 30} r={1.8} fill={shade(c, 0.25)} />
              <circle cx={x + (LOCKER - 4) / 2 + 5} cy={ly + 30} r={1.8} fill={shade(c, 0.25)} />
            </g>
          )
        })}
      </g>
    </g>
  )
})
