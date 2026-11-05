import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react'

export const SLOP = 6 // 屏幕像素:超过才算拖拽 / 平移,否则仍是点击

export const moved = (a: { x: number; y: number }, e: PointerEvent) =>
  Math.hypot(e.clientX - a.x, e.clientY - a.y) > SLOP

// jsdom 与部分 SVG 元素没有 pointer capture
export function capture(el: Element, id: number, on: boolean) {
  try {
    if (on) el.setPointerCapture?.(id)
    else if (el.hasPointerCapture?.(id)) el.releasePointerCapture?.(id)
  } catch {
    /* 忽略 */
  }
}

// 拖拽 / 平移结束后吞掉随之而来的那次点击;下次按下时复位
export function useClickGuard() {
  const armed = useRef(false)
  const arm = useCallback(() => {
    armed.current = true
  }, [])
  const reset = useCallback(() => {
    armed.current = false
  }, [])
  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!armed.current) return
    armed.current = false
    e.stopPropagation()
    e.preventDefault()
  }, [])
  return { arm, reset, onClickCapture }
}
