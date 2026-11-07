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

/** 打开后初始焦点落在首项还是末项:APG 的菜单按钮 ↓ 打开聚焦第一项、↑ 打开聚焦最后一项(L276) */
export type LayerFocus = 'first' | 'last'

/**
 * initialFocus:打开后要聚焦的元素(第二个参数说明是要首项还是末项,不区分的浮层可忽略);
 * 返回 null 时聚焦浮层本身(浮层带 tabIndex=-1)。
 * triggerDisabled:触发按钮当前是否 disabled;开着时变成 disabled 就自动关闭(L13)。
 */
export function useAnchoredLayer(
  initialFocus: (layer: HTMLElement, at: LayerFocus) => HTMLElement | null,
  triggerDisabled = false,
) {
  const [open, setOpen] = useState(false)
  const layerId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const pickFocus = useRef(initialFocus)
  useLayoutEffect(() => {
    pickFocus.current = initialFocus
  })
  // 这次打开要把焦点放在哪;每次打开都重新指定,不记住上一次
  const focusAt = useRef<LayerFocus>('first')

  /** 打开浮层;at 指定初始焦点落在首项(默认)还是末项 */
  const openLayer = useCallback((at: LayerFocus = 'first') => {
    focusAt.current = at
    setOpen(true)
  }, [])

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
    else openLayer()
  }, [open, close, openLayer])

  useEscapeLayer(open, () => close(true))

  // 浏览器后退 / 前进(popstate):页面要换了,开着的浮层跟着关;焦点不还给触发按钮(L13)
  useEffect(() => {
    if (!open) return
    const onPopState = () => close(false)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [open, close])

  // 触发按钮变 disabled(比如开始保存):disabled 的按钮聚焦不了,只关浮层不还焦点(L13)
  useEffect(() => {
    if (open && triggerDisabled) close(false)
  }, [open, triggerDisabled, close])

  // 打开后把焦点移进浮层
  useLayoutEffect(() => {
    if (!open || !layerRef.current) return
    const layer = layerRef.current
    ;(pickFocus.current(layer, focusAt.current) ?? layer).focus()
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

  return {
    open,
    openLayer,
    close,
    toggle,
    layerId,
    wrapperRef,
    triggerRef,
    layerRef,
    onWrapperBlur,
  }
}
