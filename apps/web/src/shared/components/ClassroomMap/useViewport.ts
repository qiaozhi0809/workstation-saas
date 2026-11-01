import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { capture, moved, useClickGuard } from './pointer'
import { clampView, fitView, wheelZoomFactor, zoomAt, type Size, type View } from './viewport'

const STEP = 1.2

// 舞台视口:挂载 / 舞台尺寸变化时自动适应,用户缩放或平移后不再自动适应,直到 fit()
export function useViewport(stageRef: RefObject<HTMLElement>, content: Size, enabled = true) {
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const auto = useRef(true), contentRef = useRef(content)
  contentRef.current = content
  const guard = useClickGuard()
  const pan = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null)

  const stage = useCallback((): Size => {
    const el = stageRef.current
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 }
  }, [stageRef])
  const fit = useCallback(() => {
    auto.current = true
    setView(fitView(contentRef.current, stage()))
  }, [stage])
  const apply = useCallback((f: (v: View) => View) => {
    auto.current = false
    setView((v) => clampView(f(v), contentRef.current, stage()))
  }, [stage])
  const zoomBy = useCallback((f: number) => apply((v) => zoomAt(v, f, { x: stage().w / 2, y: stage().h / 2 })), [apply, stage])
  const zoomIn = useCallback(() => zoomBy(STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / STEP), [zoomBy])
  // 自动模式重新适应,否则只夹回可见范围
  const refit = useCallback(() => {
    if (auto.current) fit()
    else setView((v) => clampView(v, contentRef.current, stage()))
  }, [fit, stage])

  const { w, h } = content
  useLayoutEffect(() => refit(), [w, h, refit])
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageRef, refit])

  // Ctrl / ⌘ + 滚轮以指针为中心缩放,普通滚轮平移
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage().h : 1
    if (e.ctrlKey || e.metaKey) {
      const r = stageRef.current?.getBoundingClientRect()
      const p = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
      apply((v) => zoomAt(v, wheelZoomFactor(e.deltaY * unit), p))
    } else {
      apply((v) => ({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit }))
    }
  }, [apply, stage, stageRef])

  useEffect(() => {
    const el = stageRef.current
    if (!el || !enabled) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stageRef, onWheel, enabled])

  const end = (e: PointerEvent) => {
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    pan.current = null
    if (!p.active) return
    capture(e.currentTarget, e.pointerId, false)
    setPanning(false)
    guard.arm()
  }
  const panHandlers = {
    onPointerDownCapture: guard.reset,
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || e.button !== 0 || e.isPrimary === false) return
      pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false }
    },
    onPointerMove: (e: PointerEvent) => {
      const p = pan.current
      if (!p || p.id !== e.pointerId) return
      if (!p.active) {
        if (!moved(p, e)) return
        p.active = true
        capture(e.currentTarget, e.pointerId, true)
        setPanning(true)
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      apply((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: guard.onClickCapture,
  }

  return { view, panning, onWheel, panHandlers, zoomIn, zoomOut, fit }
}
