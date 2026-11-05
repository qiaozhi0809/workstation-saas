import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { flushSync } from 'react-dom'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { cn } from '@/shared/lib/utils'

// Popover 与 Menu 共用:开关、点外面、焦点移出、Esc、打开时聚焦、关闭时还焦点。只供 overlay/ 内部使用。

export type LayerSide = 'top' | 'bottom'
export type LayerAlign = 'start' | 'end'

/** 浮层的定位与外观类(设计稿 §9);w-max 防止被只有触发按钮宽的包裹元素挤成窄条 */
export function layerClass(side: LayerSide, align: LayerAlign, className?: string) {
  return cn(
    'absolute z-40 w-max max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none',
    'motion-safe:animate-in motion-safe:fade-in-0',
    side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
    align === 'end' ? 'right-0' : 'left-0',
    className,
  )
}

/** initialFocus:打开后要聚焦的元素;返回 null 时聚焦浮层本身(浮层带 tabIndex=-1) */
export function useAnchoredLayer(initialFocus: (layer: HTMLElement) => HTMLElement | null) {
  const [open, setOpen] = useState(false)
  const layerId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const pickFocus = useRef(initialFocus)
  useLayoutEffect(() => {
    pickFocus.current = initialFocus
  })

  /** restoreFocus:Esc / 选中菜单项 / 再点触发按钮时把焦点还给触发按钮 */
  const close = useCallback((restoreFocus: boolean) => {
    if (!restoreFocus) {
      setOpen(false)
      return
    }
    // 先同步卸载浮层再聚焦触发按钮:若浮层还在就移焦点,里面"失焦即提交"的输入框会先提交,
    // Esc 就成了提交而不是放弃(W16)
    flushSync(() => setOpen(false))
    triggerRef.current?.focus()
  }, [])

  const toggle = useCallback(() => {
    if (open) close(true)
    else setOpen(true)
  }, [open, close])

  useEscapeLayer(open, () => close(true))

  // 打开后把焦点移进浮层
  useLayoutEffect(() => {
    if (!open || !layerRef.current) return
    const layer = layerRef.current
    ;(pickFocus.current(layer) ?? layer).focus()
  }, [open])

  // 点外面用捕获阶段的 click:到 click 时输入框已失焦并提交;捕获阶段也不怕别处 stopPropagation。
  // 按下在组件内、松手在外(如在输入框里拖选数字)时 click 落在共同祖先上,但焦点还在输入框里,
  // 这时卸载会丢掉输入(W16),所以忽略这类按下之后的那次 click
  useEffect(() => {
    if (!open) return
    let pressedInside = false
    const inside = (t: EventTarget | null) => t instanceof Node && !!wrapperRef.current?.contains(t)
    const onPointerDown = (e: PointerEvent) => {
      pressedInside = inside(e.target)
    }
    const onPointerCancel = () => {
      pressedInside = false
    }
    const onClick = (e: MouseEvent) => {
      const skip = pressedInside
      pressedInside = false
      if (!skip && wrapperRef.current && e.target instanceof Node && !inside(e.target)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [open, close])

  // 焦点移到组件外才关;relatedTarget 为空(点了不可聚焦处、切走窗口)交给点外面处理
  const onWrapperBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget
      if (open && next instanceof Node && !e.currentTarget.contains(next)) close(false)
    },
    [open, close],
  )

  return { open, setOpen, close, toggle, layerId, wrapperRef, triggerRef, layerRef, onWrapperBlur }
}
