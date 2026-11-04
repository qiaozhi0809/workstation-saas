import { memo, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import { ChairBack } from './art/Desk'
import { groupColor } from './art/palette'
import StudentFigure, { genderOf, type Pose } from './art/StudentFigure'
import { seatText } from '@/shared/lib/seats'
import type { Layout } from './layout'
import { Badge, CELL, Chip, Lock, NameTag, Ribbon, Selected } from './seatParts'
import type { ClassroomEffects, ClassroomMapProps, SeatAnchor, SeatView } from './types'

export interface MapCell { row: number; col: number; seat: Seat | null }
export type HoverSource = 'mouse' | 'focus'
export type OnHover = (src: HoverSource, id: string, key: string, on: boolean) => void
export type DragMark = 'dragging' | 'drop-on' | undefined

// 按字符计数,超出截断为 max 个字符 + …
// eslint-disable-next-line react-refresh/only-export-components
export function fitName(name: string, max = 5): string {
  const chars = Array.from(name)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : name
}

function poseOf(id: string, hovered: boolean, effects?: ClassroomEffects): Pose {
  if (effects?.pickedId === id) return 'stand'
  if (hovered) return 'turn'
  return effects?.idle?.[id] ?? 'sit'
}

const anchorOf = (el: Element): SeatAnchor => {
  const { left, top, width, height } = el.getBoundingClientRect()
  return { left, top, width, height }
}

// 可点的格子:role=button + Enter / 空格
const seatClass = (mark: DragMark, extra = '') => `cr-seat${extra}${mark ? ` cr-${mark}` : ''}`

function pressable(label: string, mark: DragMark, fire: (el: Element) => void) {
  return {
    role: 'button', tabIndex: 0, 'aria-label': label, className: seatClass(mark, ' cr-pressable'),
    onClick: (e: SyntheticEvent<SVGGElement>) => fire(e.currentTarget),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      if (!e.repeat) fire(e.currentTarget)
    },
  }
}

// 座位按钮的可访问名称:姓名,位置,再依次追加座位上显示的标签 / 徽章 / 锁定状态
// eslint-disable-next-line react-refresh/only-export-components
export function seatLabel(seat: Seat, row: number, col: number, view: SeatView, where = `第${row}排第${col}列`): string {
  const parts = [seat.name, where]
  if (view.chip?.text) parts.push(view.chip.text)
  if (view.badge?.text) parts.push(view.badge.text)
  if (seat.seat_locked || view.locked) parts.push('已锁定')
  return parts.join('，')
}

const HitArea = () => <rect className="cr-hit" x={CELL.x} y={CELL.y} width={CELL.w} height={CELL.h} rx={8} fill="transparent" />

interface CellProps {
  row: number; col: number; seat: Seat; layout: Layout; pose: Pose; view: SeatView; mark: DragMark
  onSeatClick?: ClassroomMapProps['onSeatClick']
  onHover: OnHover
}

// 外观按值比较:父组件每次新建 views 对象、但内容没变时不重画该格
const sameView = (a: SeatView, b: SeatView) => a === b || (
  a.ghost === b.ghost && a.tint === b.tint && a.selected === b.selected && a.locked === b.locked
  && a.chip?.text === b.chip?.text && a.chip?.tone === b.chip?.tone
  && a.badge?.text === b.badge?.text && a.badge?.tone === b.badge?.tone && a.badge?.strong === b.badge?.strong
)
const sameCell = (a: CellProps, b: CellProps) => {
  for (const k of Object.keys(a) as (keyof CellProps)[]) {
    if (k === 'view' ? !sameView(a.view, b.view) : a[k] !== b[k]) return false
  }
  return true
}

const OccupiedSeat = memo(function OccupiedSeat({ row, col, seat, layout, pose, view, mark, onSeatClick, onHover }: CellProps) {
  const s = layout.seat(row, col), h = layout.head(row, col), id = seat.enrollment_id, key = `${row}-${col}`
  const hover = {
    onMouseEnter: () => onHover('mouse', id, key, true), onMouseLeave: () => onHover('mouse', id, key, false),
    onFocus: () => onHover('focus', id, key, true), onBlur: () => onHover('focus', id, key, false),
  }
  const act = onSeatClick ? pressable(seatLabel(seat, row, col, view, row === 0 ? seatText({ row, col }, layout.deskGrid) : undefined), mark, (el) => onSeatClick(seat, anchorOf(el))) : { className: seatClass(mark) }
  return (
    <g data-seat={key} data-enrollment={id} data-ghost={view.ghost ? 'true' : undefined} {...hover} {...act}>
      <g transform={`translate(${s.x} ${s.y})`}><HitArea /></g>
      <g opacity={view.ghost ? 0.4 : undefined}>
        <StudentFigure x={h.x} y={h.y} gender={genderOf(seat.gender)} seed={seat.avatar_seed ?? seat.student_id}
          color={groupColor(layout.group(row, col))} pose={pose} />
        <ChairBack x={s.x} y={s.y} />
        <g transform={`translate(${s.x} ${s.y})`}>
          {seat.class_role && <Ribbon text={seat.class_role} />}
          <NameTag name={fitName(seat.name)} />
          {(seat.seat_locked || view.locked) && <Lock />}
          {view.chip && <Chip chip={view.chip} locked={seat.seat_locked || view.locked} badge={view.badge} />}
          {view.badge && <Badge badge={view.badge} />}
        </g>
      </g>
      {view.selected && <g transform={`translate(${s.x} ${s.y})`}><Selected /></g>}
    </g>
  )
}, sameCell)

function EmptySeat({ row, col, layout, mark, onEmptySeatClick }: {
  row: number; col: number; layout: Layout; mark: DragMark; onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
}) {
  const s = layout.seat(row, col)
  const act = onEmptySeatClick ? pressable(`空座 ${seatText({ row, col }, layout.deskGrid)}`, mark, () => onEmptySeatClick({ row, col })) : { className: seatClass(mark) }
  return (
    <g data-seat={`${row}-${col}`} {...act}>
      <g transform={`translate(${s.x} ${s.y})`}><HitArea /></g>
    </g>
  )
}

// mini 模式的占用座位:只有高亮的显示形象、姓名和描边(role=img,不可点);其余只画椅背,不进可访问树
const MiniSeat = memo(function MiniSeat({ row, col, seat, layout, lit }: { row: number; col: number; seat: Seat; layout: Layout; lit: boolean }) {
  const s = layout.seat(row, col), h = layout.head(row, col), key = `${row}-${col}`
  if (!lit) {
    return (
      <g data-seat={key} className="cr-seat" aria-hidden="true">
        <ChairBack x={s.x} y={s.y} />
      </g>
    )
  }
  const where = row === 0 ? `讲台${col < 0 ? '左' : '右'}侧` : `第${row}排第${col}座`
  return (
    <g data-seat={key} data-enrollment={seat.enrollment_id} className="cr-seat" role="img" aria-label={`${seat.name}的座位，${where}`}>
      <StudentFigure x={h.x} y={h.y} gender={genderOf(seat.gender)} seed={seat.avatar_seed ?? seat.student_id}
        color={groupColor(layout.group(row, col))} pose="sit" />
      <ChairBack x={s.x} y={s.y} />
      <g transform={`translate(${s.x} ${s.y})`}>
        <NameTag name={fitName(seat.name)} />
        <Selected />
      </g>
    </g>
  )
})

const NO_VIEW: SeatView = {}

interface Props {
  layout: Layout; cells: MapCell[]; interactive: boolean
  mini?: boolean; highlight?: ReadonlySet<string>
  views?: ClassroomMapProps['views']; effects?: ClassroomEffects
  onSeatClick?: ClassroomMapProps['onSeatClick']; onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
  turnedId: string | null; onHover: OnHover; dragKey: string | null; overKey: string | null
}

// 每格一个 <g data-seat>:学生 + 椅背 + 彩带 + 名字 + 锁标 / 贴纸 / 角标 + 选中框;桌椅本体在 DeskLayer
export default function SeatLayer({
  layout, cells, interactive, mini, highlight, views, effects, onSeatClick, onEmptySeatClick, turnedId, onHover, dragKey, overKey,
}: Props) {
  const markOf = (key: string): DragMark => (key === dragKey ? 'dragging' : key === overKey ? 'drop-on' : undefined)
  return (
    <g className="cr-seats">
      {cells.map(({ row, col, seat }) => mini ? (
        seat ? (
          <MiniSeat key={`${row}-${col}`} row={row} col={col} seat={seat} layout={layout} lit={!!highlight?.has(seat.enrollment_id)} />
        ) : (
          <g key={`${row}-${col}`} data-seat={`${row}-${col}`} className="cr-seat" aria-hidden="true" />
        )
      ) : seat ? (
        <OccupiedSeat key={`${row}-${col}`} row={row} col={col} seat={seat} layout={layout}
          pose={poseOf(seat.enrollment_id, turnedId === seat.enrollment_id, effects)} mark={markOf(`${row}-${col}`)}
          view={views?.[seat.enrollment_id] ?? NO_VIEW} onHover={onHover}
          onSeatClick={interactive ? onSeatClick : undefined} />
      ) : (
        <EmptySeat key={`${row}-${col}`} row={row} col={col} layout={layout} mark={markOf(`${row}-${col}`)}
          onEmptySeatClick={interactive ? onEmptySeatClick : undefined} />
      ))}
    </g>
  )
}
