import { clip, textW } from './art/kit'
import { INK, ROOM, TONES } from './art/palette'
import { M } from './layout'
import type { SeatView } from './types'

const W = M.DESK_W
const halo = { stroke: INK.outline, strokeWidth: 3, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }

// 以下部件都用座位左上角(= 桌面左上角)为原点
export function NameTag({ name }: { name: string }) {
  return (
    <text x={W / 2} y={-6} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK.hair} {...halo}>{name}</text>
  )
}

export function Lock() {
  return (
    <g role="img" aria-label="固定座位" transform="translate(4 3)">
      <path d="M 2.5 6 V 4 A 3 3 0 0 1 8.5 4 V 6" fill="none" stroke={INK.hair} strokeWidth={1.6} />
      <rect y={5.5} width={11} height={8} rx={2} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1.2} />
      <circle cx={5.5} cy={9.5} r={1.2} fill={INK.hair} />
    </g>
  )
}

const badgeW = (b: NonNullable<SeatView['badge']>) => Math.max(20, textW(b.text, 11) + 10)

export function Badge({ badge }: { badge: NonNullable<SeatView['badge']> }) {
  const t = TONES[badge.tone], w = badgeW(badge)
  return (
    <g className="cr-badge" transform={`translate(${W - 3 - w} 3)`}>
      <rect width={w} height={16} rx={8} fill={badge.strong ? t.fg : t.bg} stroke={badge.strong ? INK.outline : t.fg} strokeWidth={1.2} />
      <text x={w / 2} y={12} textAnchor="middle" fontSize={11} fontWeight={700} fill={badge.strong ? INK.outline : t.fg}>{badge.text}</text>
    </g>
  )
}

// 状态贴纸:贴在桌面上排,夹在锁标和角标之间,放不下就截断
export function Chip({ chip, locked, badge }: Pick<SeatView, 'locked' | 'badge'> & { chip: NonNullable<SeatView['chip']> }) {
  const left = locked ? 18 : 4, right = W - 3 - (badge ? badgeW(badge) + 3 : 0)
  const text = clip(chip.text, right - left - 10, 10), w = textW(text, 10) + 10, t = TONES[chip.tone]
  return (
    <g className="cr-chip" transform={`translate(${left} 3)`}>
      <rect width={w} height={16} rx={4} fill={t.bg} stroke={t.fg} strokeWidth={1} />
      <text x={w / 2} y={11.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={t.fg}>{text}</text>
    </g>
  )
}

// 职务彩带:系在椅背上,燕尾两端
export function Ribbon({ text }: { text: string }) {
  const label = clip(text, 56, 9), hw = textW(label, 9) / 2 + 6
  const d = `M ${-hw - 5} 0 L ${hw + 5} 0 L ${hw} 6 L ${hw + 5} 12 L ${-hw - 5} 12 L ${-hw} 6 Z`
  return (
    <g className="cr-ribbon" transform={`translate(${W / 2} 87)`}>
      <path d={d} fill={TONES.red.fg} stroke={INK.outline} strokeWidth={1.2} strokeLinejoin="round" />
      <text y={9} textAnchor="middle" fontSize={9} fontWeight={700} fill={INK.outline}>{label}</text>
    </g>
  )
}

// 整格热区 / 选中框的范围:名字(桌上方)到椅背下沿
// eslint-disable-next-line react-refresh/only-export-components
export const CELL = { x: 0, y: -20, w: W, h: M.SEAT_BOTTOM + 20 }
export function Selected() {
  return <rect className="cr-selected" x={CELL.x + 2} y={CELL.y} width={CELL.w - 4} height={CELL.h} rx={8} />
}
