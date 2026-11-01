import { useMemo } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import CrDefs from './art/CrDefs'
import FrontWall from './art/FrontWall'
import { ROOM } from './art/palette'
import Podium from './art/Podium'
import Room from './art/Room'
import Zones from './art/Zones'
import DeskLayer from './DeskLayer'
import Floats from './effects/Floats'
import Spotlight from './effects/Spotlight'
import { computeLayout } from './layout'
import SeatLayer, { type MapCell } from './SeatLayer'
import type { ClassroomMapProps } from './types'
import { useNow } from './useNow'
import './classroom.css'

const DEFAULT_TEACHER = { figure: 'female', label: '' } as const
const NO_FLOATS: never[] = []

function buildCells(rows: number, cols: number, seats: Seat[]): MapCell[] {
  const at = new Map<string, Seat>()
  for (const s of seats) {
    if (s.seat_row == null || s.seat_col == null) continue
    if (s.seat_row < 1 || s.seat_row > rows || s.seat_col < 1 || s.seat_col > cols) continue
    at.set(`${s.seat_row}-${s.seat_col}`, s)
  }
  return Array.from({ length: rows * cols }, (_, i) => {
    const row = Math.floor(i / cols) + 1, col = (i % cols) + 1
    return { row, col, seat: at.get(`${row}-${col}`) ?? null }
  })
}

// 纯展示:props 进、回调出。顺序:房间 → 陈设 → 前墙 → 桌椅 → 座位 → 讲台(教鞭压住第一排)→ 聚光灯 → 积分气泡
export default function ClassroomMap({
  rows, cols, seats, mode = 'daily', teacher = DEFAULT_TEACHER, board, views, effects,
  onSeatClick, onEmptySeatClick,
}: ClassroomMapProps) {
  const now = useNow()
  const mini = mode === 'mini'
  const L = useMemo(() => computeLayout(rows, cols, { decor: !mini, frontWall: !mini }), [rows, cols, mini])
  const cells = useMemo(() => buildCells(rows, cols, seats), [rows, cols, seats])
  const placed = useMemo(() => cells.flatMap((c) => (c.seat ? [c.seat] : [])), [cells])

  const headOf = (id?: string | null) => {
    const s = id ? placed.find((p) => p.enrollment_id === id) : undefined
    return s ? L.head(s.seat_row!, s.seat_col!) : null
  }
  const picked = headOf(effects?.pickedId), spot = headOf(effects?.spotlightId)
  const action = picked ? 'point' : effects?.teacher ?? 'idle'

  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="cr-anim h-auto w-full" aria-label="教室座位图">
      <CrDefs />
      {mini ? (
        <rect width={L.width} height={L.height} rx={12} fill={ROOM.floor} />
      ) : (
        <>
          <Room layout={L} rows={rows} />
          <Zones zones={L.zones} />
          {L.frontWall && <FrontWall rect={L.frontWall} board={board} now={now} />}
        </>
      )}
      <DeskLayer layout={L} cells={cells} />
      <SeatLayer layout={L} cells={cells} interactive={mode !== 'overview'} views={views} effects={effects}
        onSeatClick={onSeatClick} onEmptySeatClick={onEmptySeatClick} />
      {L.podium && <Podium rect={L.podium} teacher={teacher} action={action} pointAt={picked ?? undefined} />}
      <Spotlight at={spot} />
      <Floats items={effects?.floats ?? NO_FLOATS} layout={L} seats={placed} />
    </svg>
  )
}
