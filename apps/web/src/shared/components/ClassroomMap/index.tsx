import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import Avatar from './art/Avatar'
import CrDefs from './art/CrDefs'
import FrontWall from './art/FrontWall'
import { ROOM, groupColor } from './art/palette'
import Podium from './art/Podium'
import Room from './art/Room'
import { genderOf } from './art/StudentFigure'
import Zones from './art/Zones'
import DeskLayer from './DeskLayer'
import Floats from './effects/Floats'
import Spotlight from './effects/Spotlight'
import HoverCard, { PresentingCard, SeatCard } from './HoverCard'
import { computeLayout, groupOf, type Layout } from './layout'
import SeatLayer, { type HoverSource, type MapCell, type OnHover } from './SeatLayer'
import type { ClassroomMapProps } from './types'
import { useNow } from './useNow'
import { useSeatDrag } from './useSeatDrag'
import { useViewport } from './useViewport'
import './classroom.css'

const DEFAULT_TEACHER = { figure: 'female', label: '' } as const
const NO_FLOATS: never[] = []
const SHOW_MS = 200, HIDE_MS = 120

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

type SceneProps = Pick<ClassroomMapProps, 'rows' | 'board' | 'views' | 'effects' | 'onSeatClick' | 'onEmptySeatClick'> & {
  L: Layout; mini: boolean; interactive: boolean; cells: MapCell[]; placed: Seat[]
  teacher: NonNullable<ClassroomMapProps['teacher']>
  turnedId: string | null; onHover: OnHover; dragKey: string | null; overKey: string | null
}

// 整张 svg(自然尺寸);平移 / 缩放只改外层 transform,不重画这里
// 顺序:房间 → 陈设 → 前墙 → 桌椅 → 座位 → 讲台(教鞭压住第一排)→ 聚光灯 → 积分气泡
const Scene = memo(function Scene({ L, mini, rows, board, teacher, effects, placed, ...seat }: SceneProps) {
  const now = useNow()
  const headOf = (id?: string | null) => {
    const s = id ? placed.find((p) => p.enrollment_id === id) : undefined
    return s ? L.head(s.seat_row!, s.seat_col!) : null
  }
  const picked = headOf(effects?.pickedId), spot = headOf(effects?.spotlightId)
  const action = picked ? 'point' : effects?.teacher ?? 'idle'
  return (
    <svg width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} className="block" aria-label="教室座位图">
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
      <DeskLayer layout={L} cells={seat.cells} />
      <SeatLayer layout={L} effects={effects} {...seat} />
      {L.podium && <Podium rect={L.podium} teacher={teacher} action={action} pointAt={picked ?? undefined} />}
      <Spotlight at={spot} />
      <Floats items={effects?.floats ?? NO_FLOATS} layout={L} seats={placed} />
    </svg>
  )
})

interface Hover { id: string; key: string }
interface HoverState { mouse: Hover | null; focus: Hover | null; last: HoverSource }
const NO_HOVER: HoverState = { mouse: null, focus: null, last: 'mouse' }

// 纯展示:props 进、回调出。舞台(滚轮 / 平移)→ 变换画布 → svg;悬停卡与拖拽影子是舞台内的 HTML
export default function ClassroomMap({
  rows, cols, seats, mode = 'daily', teacher = DEFAULT_TEACHER, board, views, effects, presenting,
  renderHoverCard, onSeatClick, onEmptySeatClick, onSeatDrop, viewportRef,
}: ClassroomMapProps) {
  const mini = mode === 'mini'
  const stageRef = useRef<HTMLDivElement>(null)
  const L = useMemo(() => computeLayout(rows, cols, { decor: !mini, frontWall: !mini }), [rows, cols, mini])
  const cells = useMemo(() => buildCells(rows, cols, seats), [rows, cols, seats])
  const cellMap = useMemo(() => new Map(cells.map((c) => [`${c.row}-${c.col}`, c])), [cells])
  const placed = useMemo(() => cells.flatMap((c) => (c.seat ? [c.seat] : [])), [cells])
  const content = useMemo(() => ({ w: L.width, h: L.height }), [L])

  const vp = useViewport(stageRef, content, !mini)
  const { zoomIn, zoomOut, fit } = vp
  useImperativeHandle(viewportRef, () => ({ zoomIn, zoomOut, fit }), [zoomIn, zoomOut, fit])

  const cellAt = useCallback((key: string) => cellMap.get(key), [cellMap])
  const locked = useCallback((s: Seat) => s.seat_locked || !!views?.[s.enrollment_id]?.locked, [views])
  const { drag, handlers: dh } = useSeatDrag({
    stageRef, cellAt, locked, onDrop: mini || mode === 'overview' ? undefined : onSeatDrop,
  })
  const ph = vp.panHandlers

  // 鼠标悬停与键盘聚焦分开记:最近发生的一方生效,它结束后退回另一方
  const [hover, setHover] = useState<HoverState>(NO_HOVER)
  const onHover = useCallback<OnHover>((src, id, key, on) => setHover((h) => {
    if (on) return { ...h, [src]: { id, key }, last: src }
    return h[src]?.id === id && h[src]?.key === key ? { ...h, [src]: null } : h
  }), [])
  const live = useCallback((x: Hover | null) => (x && cellMap.get(x.key)?.seat?.enrollment_id === x.id ? x : null), [cellMap])
  // 座位数据变了:悬停 / 聚焦的学生不在原格就清掉
  useLayoutEffect(() => setHover((h) => {
    const mouse = live(h.mouse), focus = live(h.focus)
    return mouse === h.mouse && focus === h.focus ? h : { ...h, mouse, focus }
  }), [live])
  const active = hover.last === 'focus' ? hover.focus ?? hover.mouse : hover.mouse ?? hover.focus

  // 悬停卡:200ms 后出现;已显示时换人立即跟随;离开 120ms 后隐藏;拖拽 / 平移时隐藏
  const busy = !!drag || vp.panning
  const [card, setCard] = useState<Hover | null>(null)
  const tid = busy || mini ? null : active?.id ?? null, tkey = active?.key ?? null
  useEffect(() => {
    const next = tid && tkey ? { id: tid, key: tkey } : null
    if (next) setCard((c) => (c ? next : c))
    const t = setTimeout(() => setCard(next), next ? SHOW_MS : HIDE_MS)
    return () => clearTimeout(t)
  }, [tid, tkey])
  const cardSeat = card && !busy ? live(card) && cellMap.get(card.key)!.seat : null

  const stageHandlers = {
    onPointerDownCapture: () => { dh.onPointerDownCapture(); ph.onPointerDownCapture() },
    onPointerDown: (e: PointerEvent) => { if (!dh.onPointerDown(e)) ph.onPointerDown(e) },
    onPointerMove: (e: PointerEvent) => { dh.onPointerMove(e); ph.onPointerMove(e) },
    onPointerUp: (e: PointerEvent) => { dh.onPointerUp(e); ph.onPointerUp(e) },
    onPointerCancel: (e: PointerEvent) => { dh.onPointerCancel(e); ph.onPointerCancel(e) },
    onClickCapture: (e: MouseEvent) => { dh.onClickCapture(e); ph.onClickCapture(e) },
  }
  const { s, x, y } = vp.view
  const stageCls = `cr-stage cr-anim relative h-full w-full overflow-hidden ${mini ? 'min-h-[160px]' : 'min-h-[480px] touch-none select-none'}`

  return (
    <div ref={stageRef} className={`${stageCls}${busy ? ' cr-grabbing' : ''}`} data-pan={mini ? undefined : ''} {...stageHandlers}>
      <div className="cr-canvas absolute left-0 top-0" style={{ transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: '0 0' }}>
        <Scene L={L} mini={mini} rows={rows} board={board} teacher={teacher} views={views} effects={effects}
          interactive={mode !== 'overview'} cells={cells} placed={placed}
          onSeatClick={onSeatClick} onEmptySeatClick={onEmptySeatClick}
          turnedId={active?.id ?? null} onHover={onHover}
          dragKey={drag ? `${drag.from.row}-${drag.from.col}` : null} overKey={drag?.over ?? null} />
      </div>
      {cardSeat && card && (
        <HoverCard stageRef={stageRef} seatKey={card.key}>
          {presenting ? <PresentingCard seat={cardSeat} /> : renderHoverCard ? renderHoverCard(cardSeat) : <SeatCard seat={cardSeat} />}
        </HoverCard>
      )}
      {drag && (
        <div className="cr-drag-ghost pointer-events-none absolute z-20" style={{ left: drag.x, top: drag.y }}>
          <Avatar gender={genderOf(drag.from.seat.gender)} seed={drag.from.seat.avatar_seed ?? drag.from.seat.student_id}
            color={groupColor(groupOf(drag.from.col))} size={48} title={drag.from.seat.name} />
        </div>
      )}
    </div>
  )
}
