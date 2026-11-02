import type { ReactElement } from 'react'
import { GROUP_COLORS, INK, ROOM, SHADOW } from './palette'
import { WOOD, WOOD_DARK, edge, shade, thin, tint } from './kit'

// 两翼的陈设,本地坐标原点 = 区域(墙面 / 地板)左上角
const WIN_W = 120, WIN_GAP = 24, WIN_Y = 22, SKIRT = 26, PANE = 8
const LEAF = GROUP_COLORS[5]
// 光斑离左墙门口留出的距离(门画在场景最左 24px 内)
const DOOR_CLEAR = 24

// eslint-disable-next-line react-refresh/only-export-components
export const windowCount = (w: number) => Math.max(0, Math.floor((w - 24) / 144))

// 一排窗在宽 w 里水平居中时每扇窗的左边 x;窗户和地面光斑共用
function windowXs(w: number, count: number): number[] {
  const x0 = (w - (count * (WIN_W + WIN_GAP) - WIN_GAP)) / 2
  return Array.from({ length: count }, (_, i) => x0 + i * (WIN_W + WIN_GAP))
}

// 树冠剪影:三团圆叠一块平底,底边落在 base 上
function Crown({ cx, base, r, fill }: { cx: number; base: number; r: number; fill: string }) {
  return (
    <g fill={fill}>
      <circle cx={cx - r * 0.55} cy={base - r * 1.1} r={r * 0.75} />
      <circle cx={cx + r * 0.5} cy={base - r} r={r * 0.7} />
      <circle cx={cx} cy={base - r * 1.5} r={r * 0.8} />
      <rect x={cx - r * 1.15} y={base - r * 1.1} width={r * 2.3} height={r * 1.1} />
    </g>
  )
}

// 正面看的一扇窗:木框 + 天色 + 窗外树冠 + 十字窗棂 + 窗台;flip 让相邻窗的树左右错开
function Window({ hgt, flip }: { hgt: number; flip: boolean }) {
  const gw = WIN_W - 2 * PANE, gb = hgt - PANE, mid = WIN_W / 2
  const tx = PANE + (hgt - 2 * PANE) * 0.38
  const fx = (x: number) => (flip ? WIN_W - x : x)
  return (
    <g>
      <rect width={WIN_W} height={hgt} rx={4} fill={WOOD} {...edge} filter={SHADOW} />
      <rect x={PANE} y={PANE} width={gw} height={hgt - 2 * PANE} fill={ROOM.window} />
      <Crown cx={fx(40)} base={gb} r={18} fill={tint(LEAF, 0.45)} />
      <Crown cx={fx(80)} base={gb} r={24} fill={shade(LEAF, 0.08)} />
      <path d={`M ${fx(18)} ${PANE + 22} L ${fx(30)} ${PANE + 10} M ${fx(18)} ${PANE + 34} L ${fx(40)} ${PANE + 12}`}
        stroke={INK.outline} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
      <g strokeLinecap="butt">
        <path d={`M ${mid} ${PANE} L ${mid} ${gb} M ${PANE} ${tx} L ${WIN_W - PANE} ${tx}`} stroke={WOOD_DARK} strokeWidth={5} />
        <path d={`M ${mid} ${PANE} L ${mid} ${gb} M ${PANE} ${tx} L ${WIN_W - PANE} ${tx}`} stroke={ROOM.desk} strokeWidth={1.5} />
      </g>
      <circle cx={mid} cy={tx} r={3} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1} />
      <rect x={-6} y={hgt - 3} width={WIN_W + 12} height={8} rx={2} fill={WOOD_DARK} {...thin} filter={SHADOW} />
    </g>
  )
}

export function WindowRow({ w, h }: { w: number; h: number }): ReactElement {
  // 窗高跟着墙高走,窗台(下沿 +5)离踢脚线至少留 14
  const hgt = Math.min(146, h - SKIRT - WIN_Y - 19)
  return (
    <g className="cr-wing-windows">
      {hgt > 2 * PANE && windowXs(w, windowCount(w)).map((x, i) => (
        <g key={i} className="cr-wing-window" transform={`translate(${x} ${WIN_Y})`}>
          <Window hgt={hgt} flip={i % 2 === 1} />
        </g>
      ))}
    </g>
  )
}

// 每扇窗在地板上投一块向左下斜的浅色光斑(同 Room 右墙窗的光斑画法),夹在地板内、避开左墙门口
export function WindowLight({ w, h, count }: { w: number; h: number; count: number }): ReactElement {
  const depth = Math.min(h * 0.28, 300), skew = depth * 0.3
  const cx = (x: number) => Math.min(w, Math.max(DOOR_CLEAR, x))
  return (
    <g className="cr-wing-light" fill={INK.outline} opacity={0.35}>
      {windowXs(w, count).map((x, i) => (
        <path key={i}
          d={`M ${cx(x)} 0 L ${cx(x + WIN_W)} 0 L ${cx(x + WIN_W - skew)} ${depth} L ${cx(x - skew)} ${depth} Z`} />
      ))}
    </g>
  )
}
