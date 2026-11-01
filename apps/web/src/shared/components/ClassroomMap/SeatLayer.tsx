import { memo, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import { ChairBack } from './art/Desk'
import { groupColor } from './art/palette'
import StudentFigure, { genderOf, type Pose } from './art/StudentFigure'
import { groupOf, type Layout } from './layout'
import { Badge, CELL, Chip, Lock, NameTag, Ribbon, Selected } from './seatParts'
import type { ClassroomEffects, ClassroomMapProps, SeatAnchor, SeatView } from './types'

export interface MapCell { row: number; col: number; seat: Seat | null }

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
function pressable(label: string, fire: (el: Element) => void) {
  return {
    role: 'button', tabIndex: 0, 'aria-label': label, className: 'cr-seat cr-pressable',
    onClick: (e: SyntheticEvent<SVGGElement>) => fire(e.currentTarget),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      fire(e.currentTarget)
    },
  }
}

const HitArea = () => <rect className="cr-hit" x={CELL.x} y={CELL.y} width={CELL.w} height={CELL.h} rx={8} fill="transparent" />

interface CellProps {
  row: number; col: number; seat: Seat; layout: Layout; pose: Pose; view: SeatView
  onSeatClick?: ClassroomMapProps['onSeatClick']
  onHover: (id: string | null) => void
}

const OccupiedSeat = memo(function OccupiedSeat({ row, col, seat, layout, pose, view, onSeatClick, onHover }: CellProps) {
  const s = layout.seat(row, col), h = layout.head(row, col), id = seat.enrollment_id
  const hover = { onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null), onFocus: () => onHover(id), onBlur: () => onHover(null) }
  const act = onSeatClick ? pressable(seat.name, (el) => onSeatClick(seat, anchorOf(el))) : { className: 'cr-seat' }
  return (
    <g data-seat={`${row}-${col}`} data-enrollment={id} data-ghost={view.ghost ? 'true' : undefined} {...hover} {...act}>
      <g transform={`translate(${s.x} ${s.y})`}><HitArea /></g>
      <g opacity={view.ghost ? 0.4 : undefined}>
        <StudentFigure x={h.x} y={h.y} gender={genderOf(seat.gender)} seed={seat.avatar_seed ?? seat.student_id}
          color={groupColor(groupOf(col))} pose={pose} />
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
})

function EmptySeat({ row, col, layout, onEmptySeatClick }: {
  row: number; col: number; layout: Layout; onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
}) {
  const s = layout.seat(row, col)
  const act = onEmptySeatClick ? pressable(`空座 ${row}排${col}列`, () => onEmptySeatClick({ row, col })) : { className: 'cr-seat' }
  return (
    <g data-seat={`${row}-${col}`} {...act}>
      <g transform={`translate(${s.x} ${s.y})`}><HitArea /></g>
    </g>
  )
}

const NO_VIEW: SeatView = {}

interface Props {
  layout: Layout; cells: MapCell[]; interactive: boolean
  views?: ClassroomMapProps['views']; effects?: ClassroomEffects
  onSeatClick?: ClassroomMapProps['onSeatClick']; onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
}

// 每格一个 <g data-seat>:学生 + 椅背 + 彩带 + 名字 + 锁标 / 贴纸 / 角标 + 选中框;桌椅本体在 DeskLayer
export default function SeatLayer({ layout, cells, interactive, views, effects, onSeatClick, onEmptySeatClick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <g className="cr-seats">
      {cells.map(({ row, col, seat }) => seat ? (
        <OccupiedSeat key={`${row}-${col}`} row={row} col={col} seat={seat} layout={layout}
          pose={poseOf(seat.enrollment_id, hovered === seat.enrollment_id, effects)}
          view={views?.[seat.enrollment_id] ?? NO_VIEW} onHover={setHovered}
          onSeatClick={interactive ? onSeatClick : undefined} />
      ) : (
        <EmptySeat key={`${row}-${col}`} row={row} col={col} layout={layout}
          onEmptySeatClick={interactive ? onEmptySeatClick : undefined} />
      ))}
    </g>
  )
}
