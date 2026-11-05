import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type UIEvent,
} from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import Avatar from './art/Avatar'
import CrDefs from './art/CrDefs'
import FrontWall from './art/FrontWall'
import { ROOM, groupColor } from './art/palette'
import Podium from './art/Podium'
import Room from './art/Room'
import { genderOf } from './art/StudentFigure'
import Wings from './art/Wings'
import { attendanceBoardRect } from './art/wingArt'
import Zones from './art/Zones'
import DeskLayer from './DeskLayer'
import Floats from './effects/Floats'
import Spotlight from './effects/Spotlight'
import HoverCard, { PresentingCard, SeatCard } from './HoverCard'
import { inGrid } from '@/shared/lib/seats'
import { SCENE_ASPECT, computeLayout, type Layout } from './layout'
import SeatLayer, { type HoverSource, type MapCell, type OnHover } from './SeatLayer'
import type { ClassroomMapProps } from './types'
import { rectFullyShownInFit, type Size } from './viewport'
import { useNow } from './useNow'
import { useSeatDrag } from './useSeatDrag'
import { useViewport } from './useViewport'
import ZoomControls from './ZoomControls'
import './classroom.css'

const DEFAULT_TEACHER = { figure: 'female', label: '' } as const
const NO_FLOATS: never[] = []
const SHOW_MS = 200,
  HIDE_MS = 120

function buildCells(L: Layout, seats: Seat[]): MapCell[] {
  const at = new Map<string, Seat>()
  for (const s of seats) {
    if (s.seat_row == null || s.seat_col == null) continue
    if (!inGrid(L.deskGrid, { row: s.seat_row, col: s.seat_col })) continue
    at.set(`${s.seat_row}-${s.seat_col}`, s)
  }
  return L.cells.map(({ row, col }) => ({ row, col, seat: at.get(`${row}-${col}`) ?? null }))
}

type SceneProps = Pick<
  ClassroomMapProps,
  'rows' | 'board' | 'attendanceBoard' | 'views' | 'effects' | 'onSeatClick' | 'onEmptySeatClick'
> & {
  L: Layout
  mini: boolean
  highlight?: ReadonlySet<string>
  interactive: boolean
  cells: MapCell[]
  podCells: MapCell[]
  placed: Seat[]
  figure: 'female' | 'male'
  label: string
  turnedId: string | null
  onHover: OnHover
  dragKey: string | null
  overKey: string | null
}

// 只有前墙跟着每分钟的挂钟重画
function LiveFrontWall(props: Omit<Parameters<typeof FrontWall>[0], 'now'>) {
  return <FrontWall {...props} now={useNow()} />
}

// 整张 svg(自然尺寸);平移 / 缩放只改外层 transform,不重画这里
// 顺序:房间 → 陈设 → 前墙 → 桌椅 → 讲台 → 讲台两侧桌椅与座位(不被地台盖住)→ 普通座位 → 聚光灯 → 积分气泡
// 讲台座位排在普通座位之前,键盘 Tab 顺序才是画面从前到后;教鞭最低约 y=334,在地台下沿 y=364 之上,与第一排热区(上沿 y=368)不重叠,顺序不影响遮挡
const Scene = memo(function Scene({
  L,
  mini,
  rows,
  board,
  attendanceBoard,
  figure,
  label,
  effects,
  placed,
  podCells,
  ...seat
}: SceneProps) {
  const teacher = useMemo(() => ({ figure, label }), [figure, label])
  const headOf = (id?: string | null) => {
    const s = id ? placed.find((p) => p.enrollment_id === id) : undefined
    return s ? L.head(s.seat_row!, s.seat_col!) : null
  }
  const picked = headOf(effects?.pickedId),
    spot = headOf(effects?.spotlightId)
  const action = picked ? 'point' : (effects?.teacher ?? 'idle')
  return (
    <svg
      width={L.width}
      height={L.height}
      viewBox={`0 0 ${L.width} ${L.height}`}
      className="block"
      aria-label="教室座位图"
    >
      <CrDefs />
      {mini ? (
        <rect width={L.width} height={L.height} rx={12} fill={ROOM.floor} />
      ) : (
        <>
          <Room layout={L} rows={rows} />
          <Wings layout={L} attendanceBoard={attendanceBoard} />
          <Zones zones={L.zones} />
          {L.frontWall && <LiveFrontWall rect={L.frontWall} board={board} />}
        </>
      )}
      <DeskLayer layout={L} cells={seat.cells} views={seat.views} />
      {L.podium && (
        <Podium rect={L.podium} teacher={teacher} action={action} pointAt={picked ?? undefined} />
      )}
      {podCells.length > 0 && (
        <>
          <DeskLayer layout={L} cells={podCells} views={seat.views} />
          <SeatLayer layout={L} mini={mini} effects={effects} {...seat} cells={podCells} />
        </>
      )}
      <SeatLayer layout={L} mini={mini} effects={effects} {...seat} />
      <Spotlight at={spot} />
      <Floats items={effects?.floats ?? NO_FLOATS} layout={L} seats={placed} />
    </svg>
  )
})

interface Hover {
  id: string
  key: string
}
interface HoverState {
  mouse: Hover | null
  focus: Hover | null
  last: HoverSource
}
const NO_HOVER: HoverState = { mouse: null, focus: null, last: 'mouse' }

// 纯展示:props 进、回调出。舞台(滚轮 / 平移)→ 变换画布 → svg;悬停卡与拖拽影子是舞台内的 HTML
export default function ClassroomMap({
  rows,
  cols,
  deskSize = 2,
  podium,
  seats,
  mode = 'daily',
  teacher = DEFAULT_TEACHER,
  board,
  attendanceBoard,
  onAttendanceBoardVisibleChange,
  views,
  highlight,
  effects,
  presenting,
  renderHoverCard,
  onSeatClick,
  onEmptySeatClick,
  onSeatDrop,
  viewportRef,
  zoomControls = false,
}: ClassroomMapProps) {
  const mini = mode === 'mini'
  const stageRef = useRef<HTMLDivElement>(null)
  const podLeft = podium?.left ?? 0,
    podRight = podium?.right ?? 0
  const L = useMemo(
    () =>
      computeLayout(rows, cols, {
        decor: !mini,
        frontWall: !mini,
        aspect: mini ? undefined : SCENE_ASPECT,
        deskSize,
        podium: { left: podLeft, right: podRight },
      }),
    [rows, cols, mini, deskSize, podLeft, podRight],
  )
  const allCells = useMemo(() => buildCells(L, seats), [L, seats])
  const cells = useMemo(() => allCells.filter((c) => c.row !== 0), [allCells])
  const podCells = useMemo(() => allCells.filter((c) => c.row === 0), [allCells])
  const cellMap = useMemo(() => new Map(allCells.map((c) => [`${c.row}-${c.col}`, c])), [allCells])
  const lit = useMemo(() => (mini ? new Set(highlight) : undefined), [mini, highlight])
  const placed = useMemo(() => allCells.flatMap((c) => (c.seat ? [c.seat] : [])), [allCells])
  const content = useMemo(() => ({ w: L.width, h: L.height, safeW: L.safe.w, core: L.core }), [L])

  const vp = useViewport(stageRef, content, !mini)
  const { zoomIn, zoomOut, fit } = vp
  useImperativeHandle(viewportRef, () => ({ zoomIn, zoomOut, fit }), [zoomIn, zoomOut, fit])

  // 出勤小牌是否看得到:按适应(锁定)视图判断,放大拖动不改变;舞台尺寸变了才重算
  const [stageSize, setStageSize] = useState<Size>({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || mini) return
    const read = () =>
      setStageSize((z) =>
        z.w === el.clientWidth && z.h === el.clientHeight
          ? z
          : { w: el.clientWidth, h: el.clientHeight },
      )
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mini])
  const boardRect = useMemo(
    () => (mini || !attendanceBoard ? null : attendanceBoardRect(L)),
    [L, mini, attendanceBoard],
  )
  const boardVisible =
    !!boardRect && rectFullyShownInFit(content, stageSize, L.safe.w, boardRect, L.core)
  const onBoardVisible = useRef(onAttendanceBoardVisibleChange)
  onBoardVisible.current = onAttendanceBoardVisibleChange
  useLayoutEffect(() => {
    onBoardVisible.current?.(boardVisible)
  }, [boardVisible])
  useLayoutEffect(() => () => onBoardVisible.current?.(false), [])

  const cellAt = useCallback((key: string) => cellMap.get(key), [cellMap])
  const locked = useCallback(
    (s: Seat) => s.seat_locked || !!views?.[s.enrollment_id]?.locked,
    [views],
  )
  const { drag, handlers: dh } = useSeatDrag({
    stageRef,
    cellAt,
    locked,
    onDrop: mini || mode === 'overview' ? undefined : onSeatDrop,
  })
  const ph = vp.panHandlers

  // 回调存最新值、往下传稳定包装:父组件传内联函数也不会重画全部座位;有没有传仍决定座位是否可点
  const latest = useRef({ onSeatClick, onEmptySeatClick })
  latest.current = { onSeatClick, onEmptySeatClick }
  const seatClick = useCallback<NonNullable<typeof onSeatClick>>(
    (s, a) => latest.current.onSeatClick?.(s, a),
    [],
  )
  const emptyClick = useCallback<NonNullable<typeof onEmptySeatClick>>(
    (c) => latest.current.onEmptySeatClick?.(c),
    [],
  )

  // 鼠标悬停与键盘聚焦分开记:最近发生的一方生效,它结束后退回另一方
  const [hover, setHover] = useState<HoverState>(NO_HOVER)
  const onHover = useCallback<OnHover>(
    (src, id, key, on) =>
      setHover((h) => {
        if (on) return { ...h, [src]: { id, key }, last: src }
        return h[src]?.id === id && h[src]?.key === key ? { ...h, [src]: null } : h
      }),
    [],
  )
  const live = useCallback(
    (x: Hover | null) => (x && cellMap.get(x.key)?.seat?.enrollment_id === x.id ? x : null),
    [cellMap],
  )
  // 座位数据变了:悬停 / 聚焦的学生不在原格就清掉
  useLayoutEffect(
    () =>
      setHover((h) => {
        const mouse = live(h.mouse),
          focus = live(h.focus)
        return mouse === h.mouse && focus === h.focus ? h : { ...h, mouse, focus }
      }),
    [live],
  )
  const active =
    hover.last === 'focus' ? (hover.focus ?? hover.mouse) : (hover.mouse ?? hover.focus)

  // 悬停卡:200ms 后出现;已显示时换人立即跟随;离开 120ms 后隐藏;拖拽 / 平移时隐藏
  const busy = !!drag || vp.panning
  const [card, setCard] = useState<Hover | null>(null)
  const tid = busy || mini ? null : (active?.id ?? null),
    tkey = active?.key ?? null
  useEffect(() => {
    const next = tid && tkey ? { id: tid, key: tkey } : null
    if (next) setCard((c) => (c ? next : c))
    const t = setTimeout(() => setCard(next), next ? SHOW_MS : HIDE_MS)
    return () => clearTimeout(t)
  }, [tid, tkey])
  const cardSeat = card && !busy ? live(card) && cellMap.get(card.key)!.seat : null

  const stageHandlers = {
    onPointerDownCapture: () => {
      dh.onPointerDownCapture()
      ph.onPointerDownCapture()
    },
    onPointerDown: (e: PointerEvent) => {
      if (!dh.onPointerDown(e)) ph.onPointerDown(e)
    },
    onPointerMove: (e: PointerEvent) => {
      dh.onPointerMove(e)
      ph.onPointerMove(e)
    },
    onPointerUp: (e: PointerEvent) => {
      dh.onPointerUp(e)
      ph.onPointerUp(e)
    },
    onPointerCancel: (e: PointerEvent) => {
      dh.onPointerCancel(e)
      ph.onPointerCancel(e)
    },
    // 缩放悬浮钮上的点击不经过两道点击防护:在它上面按下已复位防护,而拖座位 / 平移没收尾时键盘 Enter 不能被吞
    onClickCapture: (e: MouseEvent) => {
      if ((e.target as Element).closest?.('[data-zoom-controls]')) return
      dh.onClickCapture(e)
      ph.onClickCapture(e)
    },
    // 舞台自己永不滚动(否则悬停卡 / 缩放中心 / 影子全部错位);聚焦到视口外的座位时改为平移视图
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      e.currentTarget.scrollTop = 0
      e.currentTarget.scrollLeft = 0
    },
    onFocus: (e: FocusEvent) => {
      const seat = (e.target as Element).closest?.('[data-seat]')
      if (seat) vp.ensureVisible(seat.getBoundingClientRect())
    },
  }
  const { s, x, y } = vp.view
  // 抓手光标(data-pan)只在可拖动的放大状态出现
  const stageCls = `cr-stage cr-anim relative h-full w-full ${mini ? 'min-h-[160px]' : 'min-h-[120px] [@media(min-height:560px)]:min-h-[240px] touch-none select-none'}`

  return (
    <div
      ref={stageRef}
      className={`${stageCls}${busy ? ' cr-grabbing' : ''}`}
      data-pan={mini || vp.fitted ? undefined : ''}
      {...stageHandlers}
    >
      <div
        className="cr-canvas absolute left-0 top-0"
        style={{ transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: '0 0' }}
      >
        <Scene
          L={L}
          mini={mini}
          highlight={lit}
          rows={rows}
          board={board}
          attendanceBoard={mini ? undefined : attendanceBoard}
          figure={teacher.figure}
          label={teacher.label}
          views={views}
          effects={mini ? undefined : effects}
          interactive={mode !== 'overview'}
          cells={cells}
          podCells={podCells}
          placed={placed}
          onSeatClick={onSeatClick && !mini ? seatClick : undefined}
          onEmptySeatClick={onEmptySeatClick && !mini ? emptyClick : undefined}
          turnedId={active?.id ?? null}
          onHover={onHover}
          dragKey={drag ? `${drag.from.row}-${drag.from.col}` : null}
          overKey={drag?.over ?? null}
        />
      </div>
      {cardSeat && card && (
        <HoverCard stageRef={stageRef} seatKey={card.key}>
          {presenting ? (
            <PresentingCard seat={cardSeat} />
          ) : renderHoverCard ? (
            renderHoverCard(cardSeat)
          ) : (
            <SeatCard
              seat={cardSeat}
              group={L.group(cardSeat.seat_row ?? 1, cardSeat.seat_col ?? 1)}
            />
          )}
        </HoverCard>
      )}
      {drag && (
        <div
          className="cr-drag-ghost pointer-events-none absolute z-20"
          style={{ left: drag.x, top: drag.y }}
        >
          <Avatar
            gender={genderOf(drag.from.seat.gender)}
            seed={drag.from.seat.avatar_seed ?? drag.from.seat.student_id}
            color={groupColor(L.group(drag.from.row, drag.from.col))}
            size={48}
            title={drag.from.seat.name}
          />
        </div>
      )}
      {zoomControls && !mini && (
        <ZoomControls
          canZoomIn={vp.canZoomIn}
          canZoomOut={!vp.fitted}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fit}
        />
      )}
    </div>
  )
}
