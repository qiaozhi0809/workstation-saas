import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import { capture, moved, useClickGuard } from './pointer'
import type { MapCell } from './SeatLayer'
import type { Cell } from './types'

export interface DragState {
  from: MapCell & { seat: Seat }
  x: number
  y: number
  over: string | null
}

interface Options {
  stageRef: RefObject<HTMLElement>
  cellAt: (key: string) => MapCell | undefined
  locked: (seat: Seat) => boolean
  onDrop?: (from: Cell, to: Cell) => void
}

const seatKeyOf = (el: Element | null | undefined) =>
  el?.closest?.('[data-seat]')?.getAttribute('data-seat') ?? null

// 指针下的座位:优先 elementFromPoint(拖拽时指针被舞台捕获),取不到用事件目标
function keyAt(stage: HTMLElement | null, e: PointerEvent): string | null {
  const hit = document.elementFromPoint?.(e.clientX, e.clientY)
  if (hit && stage?.contains(hit)) return seatKeyOf(hit)
  return seatKeyOf(e.target as Element)
}

// 座位拖拽:仅传入 onDrop 时启用;按在有人且未锁定的座位上、移动超过 6px 才开始
export function useSeatDrag({ stageRef, cellAt, locked, onDrop }: Options) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const press = useRef<{
    id: number
    x: number
    y: number
    from: DragState['from']
    state: 'pending' | 'drag' | 'cancelled'
  } | null>(null)
  const guard = useClickGuard()

  const local = (e: PointerEvent) => {
    const r = stageRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const cancel = useCallback(() => {
    if (press.current?.state === 'drag') press.current.state = 'cancelled'
    setDrag(null)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, cancel])

  // 返回 true 表示这次按下归拖拽管(平移不再接手)
  const onPointerDown = (e: PointerEvent): boolean => {
    if (!onDrop || e.button !== 0 || e.isPrimary === false) return false
    const key = seatKeyOf(e.target as Element),
      cell = key ? cellAt(key) : undefined
    if (!cell?.seat || locked(cell.seat)) return false
    press.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      from: cell as DragState['from'],
      state: 'pending',
    }
    return true
  }
  // 可放下的格子:另一格,且格内若有人则不能是固定座位
  const target = (key: string | null, from: MapCell) => {
    const c = key ? cellAt(key) : undefined
    if (!c || (c.row === from.row && c.col === from.col) || (c.seat && locked(c.seat))) return null
    return c
  }
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current
    if (!p || p.id !== e.pointerId || p.state === 'cancelled') return
    if (p.state === 'pending') {
      if (!moved(p, e)) return
      p.state = 'drag'
      capture(e.currentTarget, e.pointerId, true)
    }
    const over = target(keyAt(stageRef.current, e), p.from)
    setDrag({ from: p.from, ...local(e), over: over ? `${over.row}-${over.col}` : null })
  }
  const end = (e: PointerEvent, drop: boolean) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    setDrag(null)
    if (p.state === 'pending') return
    capture(e.currentTarget, e.pointerId, false)
    guard.arm()
    if (!drop || p.state !== 'drag') return
    const to = target(keyAt(stageRef.current, e), p.from)
    if (to) onDrop?.({ row: p.from.row, col: p.from.col }, { row: to.row, col: to.col })
  }

  const handlers = {
    onPointerDownCapture: guard.reset,
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: PointerEvent) => end(e, true),
    onPointerCancel: (e: PointerEvent) => end(e, false),
    onClickCapture: guard.onClickCapture,
  }
  return { drag, handlers }
}
