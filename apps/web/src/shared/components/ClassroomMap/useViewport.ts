import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { capture, moved, useClickGuard } from './pointer'
import {
  MAX_S,
  clampView,
  fitView,
  wheelZoomFactor,
  zoomAt,
  type Size,
  type View,
} from './viewport'

const STEP = 1.2,
  MARGIN = 16,
  EPS = 1e-6

interface State {
  view: View
  fitted: boolean
}

// 舞台视口,两种状态:
// 适应(锁定):挂载 / 点"适应" / 缩小到适应比例时进入;舞台尺寸变化时重新适应;拖动、普通滚轮、键盘聚焦都不动视图
// 放大(可拖):从适应放大后进入;平移与缩放都夹在场景边界内;舞台变化后若比例已 ≤ 新的适应比例则回到适应
export function useViewport(
  stageRef: RefObject<HTMLElement | null>,
  content: Size & { safeW?: number; core?: { y: number; h: number } },
  enabled = true,
) {
  const [st, setSt] = useState<State>({ view: { s: 1, x: 0, y: 0 }, fitted: true })
  const [panning, setPanning] = useState(false)
  const contentRef = useRef(content),
    fittedRef = useRef(st.fitted)
  contentRef.current = content
  fittedRef.current = st.fitted
  const guard = useClickGuard()
  const pan = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null)

  const stage = useCallback((): Size => {
    const el = stageRef.current
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 }
  }, [stageRef])
  const fitOf = useCallback(() => {
    const c = contentRef.current
    return fitView(c, stage(), c.safeW ?? c.w, c.core)
  }, [stage])
  const fit = useCallback(() => setSt({ view: fitOf(), fitted: true }), [fitOf])
  // 比例已不大于适应比例就回到适应(锁定),否则只做边界夹取
  const settle = useCallback(
    (v: View, f: View): State =>
      v.s <= f.s + EPS
        ? { view: f, fitted: true }
        : { view: clampView(v, contentRef.current, stage()), fitted: false },
    [stage],
  )

  // 缩放的下限是此刻舞台的适应比例
  const zoomAround = useCallback(
    (factor: number, point: { x: number; y: number }) => {
      const f = fitOf()
      setSt((cur) => settle(zoomAt(cur.view, factor, point, f.s), f))
    },
    [fitOf, settle],
  )
  const zoomBy = useCallback(
    (k: number) => {
      const { w, h } = stage()
      zoomAround(k, { x: w / 2, y: h / 2 })
    },
    [stage, zoomAround],
  )
  const zoomIn = useCallback(() => zoomBy(STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / STEP), [zoomBy])
  // 平移只在放大状态生效
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const c = contentRef.current,
        sz = stage()
      setSt((cur) =>
        cur.fitted
          ? cur
          : {
              view: clampView({ ...cur.view, x: cur.view.x + dx, y: cur.view.y + dy }, c, sz),
              fitted: false,
            },
      )
    },
    [stage],
  )
  // 舞台 / 内容变化:适应状态重新适应;放大状态按新的适应比例决定回到适应还是只夹取
  const refit = useCallback(() => {
    const f = fitOf()
    setSt((cur) => (cur.fitted ? { view: f, fitted: true } : settle(cur.view, f)))
  }, [fitOf, settle])

  // 键盘聚焦到视口外的座位:放大状态下平移到可见;适应状态下核心(含全部座位)本就完整在舞台内,不动;rect 为视口坐标
  const ensureVisible = useCallback(
    (r: { left: number; top: number; width: number; height: number }) => {
      const el = stageRef.current,
        { w, h } = stage()
      if (!el || !w || !h || fittedRef.current) return
      const o = el.getBoundingClientRect()
      const shift = (lo: number, len: number, room: number) => {
        const m = Math.min(MARGIN, Math.max(0, (room - len) / 2))
        if (lo < m) return m - lo
        if (lo + len > room - m) return Math.max(room - m - lo - len, m - lo)
        return 0
      }
      const dx = shift(r.left - o.left, r.width, w),
        dy = shift(r.top - o.top, r.height, h)
      if (dx || dy) panBy(dx, dy)
    },
    [panBy, stage, stageRef],
  )

  const { w, h, safeW } = content,
    coreY = content.core?.y,
    coreH = content.core?.h
  useLayoutEffect(() => refit(), [w, h, safeW, coreY, coreH, refit])
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageRef, refit])

  // Ctrl / ⌘ + 滚轮以指针为中心缩放;普通滚轮只在放大状态平移,适应状态什么都不做(仍阻止页面滚动)
  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage().h : 1
      if (e.ctrlKey || e.metaKey) {
        const r = stageRef.current?.getBoundingClientRect()
        zoomAround(wheelZoomFactor(e.deltaY * unit), {
          x: e.clientX - (r?.left ?? 0),
          y: e.clientY - (r?.top ?? 0),
        })
      } else {
        panBy(-e.deltaX * unit, -e.deltaY * unit)
      }
    },
    [panBy, stage, stageRef, zoomAround],
  )

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
    // 适应状态不开始平移(不捕获指针、不显示抓手),点座位 / 拖座位照常
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || fittedRef.current || e.button !== 0 || e.isPrimary === false) return
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
      const dx = e.clientX - p.x,
        dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      panBy(dx, dy)
    },
    onPointerUp: end,
    onPointerCancel: end,
    // 只吞平移后的那次鼠标点击;键盘触发的点击(detail 为 0)放行,否则平移没收尾时舞台里的缩放钮按 Enter 会失灵
    onClickCapture: (e: MouseEvent) => {
      if (e.detail !== 0) guard.onClickCapture(e)
    },
  }

  const { view, fitted } = st
  const canZoomIn = view.s < MAX_S - EPS
  return {
    view,
    fitted,
    canZoomIn,
    panning,
    onWheel,
    panHandlers,
    zoomIn,
    zoomOut,
    fit,
    ensureVisible,
  }
}
