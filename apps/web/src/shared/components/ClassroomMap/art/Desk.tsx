import { M } from '../layout'
import { seededRandom } from './hash'
import { GROUP_COLORS, INK, ROOM } from './palette'
import { WOOD, edge, shade, thin, tint } from './kit'

type Kind = 'book' | 'pencils' | 'bottle' | 'notebook'
interface Prop { kind: Kind; dx: number; dy: number; color: string }
const KINDS: Kind[] = ['book', 'pencils', 'bottle', 'notebook']
const W = M.DESK_W, D = M.DESK_D
// 各道具的最右伸出量(含旋转后的笔尖),用于把 dx 限制在桌面内
const SPAN: Record<Kind, number> = { book: 18, pencils: 24, bottle: 15, notebook: 21 }

// 桌面分成三格,每格至多一件,1–3 件
// eslint-disable-next-line react-refresh/only-export-components
export function deskProps(seed: string): Prop[] {
  const rnd = seededRandom(seed)
  const n = 1 + Math.floor(rnd() * 3)
  const slots = [0, 1, 2]
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  return slots.slice(0, n).sort((a, b) => a - b).map((s) => {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)]
    return {
      kind,
      dx: Math.min(s * 28 + 4 + Math.floor(rnd() * 5), W - 3 - SPAN[kind]),
      dy: 5 + Math.floor(rnd() * 6),
      color: GROUP_COLORS[Math.floor(rnd() * GROUP_COLORS.length)],
    }
  })
}

function DeskProp({ kind, dx, dy, color }: Prop) {
  switch (kind) {
    case 'book':
      return (
        <g transform={`translate(${dx} ${dy})`}>
          <rect x={1} y={1} width={17} height={21} rx={1.5} fill={ROOM.desk} stroke={ROOM.deskEdge} strokeWidth={1} />
          <rect width={17} height={21} rx={1.5} fill={color} {...thin} />
          <path d="M 4 1 L 4 21" stroke={shade(color, 0.2)} strokeWidth={1.4} />
          <rect x={7} y={5} width={7} height={3} rx={1} fill={tint(color)} />
        </g>
      )
    case 'pencils':
      return (
        <g transform={`translate(${dx} ${dy + 4}) rotate(-12)`}>
          {[0, 6].map((o, i) => (
            <g key={o} transform={`translate(0 ${o})`}>
              <rect width={17} height={4} rx={1} fill={i ? ROOM.gold : color} stroke={INK.outline} strokeWidth={1} />
              <path d="M 17 0 L 22 2 L 17 4 Z" fill={ROOM.deskEdge} />
              <circle cx={21.5} cy={2} r={0.9} fill={INK.hair} />
            </g>
          ))}
        </g>
      )
    case 'bottle':
      return (
        <g transform={`translate(${dx + 4} ${dy})`}>
          <rect x={0} y={4} width={11} height={19} rx={4} fill={tint(color, 0.35)} {...thin} />
          <rect x={2.5} y={0} width={6} height={5} rx={1.5} fill={color} {...thin} />
          <rect x={2} y={11} width={7} height={5} rx={1} fill={INK.outline} opacity={0.8} />
        </g>
      )
    case 'notebook':
      return (
        <g transform={`translate(${dx} ${dy + 3})`}>
          <rect width={21} height={16} rx={1.5} fill={tint(color, 0.55)} {...thin} />
          {[4, 8.5, 13, 17.5].map((x) => <circle key={x} cx={x - 0.5} cy={1.8} r={1} fill={shade(color, 0.2)} />)}
          <path d="M 4 7 L 17 7 M 4 11 L 14 11" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
        </g>
      )
  }
}

// x,y = 座位左上角(即桌面左上角);桌面 84×40,下沿 6px 是朝向学生的桌边。
// 不传 seed = 空桌(无道具);top 覆盖桌面顶面色(成绩模式)。投影由外层整组桌椅统一加 SHADOW。
export default function Desk({ x, y, seed, top = ROOM.desk }: { x: number; y: number; seed?: string; top?: string }) {
  return (
    <g className="cr-desk" transform={`translate(${x} ${y})`}>
      <rect x={1} y={1} width={W - 2} height={D - 2} rx={3} fill={top} {...edge} />
      <rect x={1} y={D - 7} width={W - 2} height={6} rx={2} fill={ROOM.deskEdge} />
      {seed && deskProps(seed).map((p, i) => <DeskProp key={i} {...p} />)}
    </g>
  )
}

const CHAIR = WOOD, SEAT_Y = 62

// 椅面:画在学生身体下面,两侧比身体各宽出约 4px
export function ChairSeat({ x, y }: { x: number; y: number }) {
  return (
    <g className="cr-chair-seat" transform={`translate(${x + W / 2} ${y})`}>
      <rect x={-34} y={SEAT_Y} width={68} height={28} rx={6} fill={tint(CHAIR, 0.35)} {...edge} />
    </g>
  )
}

// 椅背:离观察者更近,压在学生衣摆上
export function ChairBack({ x, y }: { x: number; y: number }) {
  return (
    <g className="cr-chair-back" transform={`translate(${x + W / 2} ${y})`}>
      <rect x={-30} y={SEAT_Y + 18} width={6} height={20} rx={2} fill={shade(CHAIR, 0.1)} {...thin} />
      <rect x={24} y={SEAT_Y + 18} width={6} height={20} rx={2} fill={shade(CHAIR, 0.1)} {...thin} />
      <rect x={-33} y={SEAT_Y + 23} width={66} height={14} rx={5} fill={CHAIR} {...edge} />
    </g>
  )
}
