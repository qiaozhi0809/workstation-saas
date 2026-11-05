import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/shared/components/ui/button'
import { layerClass, useAnchoredLayer } from './useAnchoredLayer'

export interface PopoverProps {
  /** 浮层的可访问名称 */
  label: string
  /** 触发按钮里的内容 */
  trigger: ReactNode
  triggerProps?: Omit<
    ButtonProps,
    'children' | 'onClick' | 'aria-expanded' | 'aria-haspopup' | 'aria-controls'
  >
  /** 默认 'bottom';底部操作台用 'top' */
  side?: 'top' | 'bottom'
  /** 默认 'start' */
  align?: 'start' | 'end'
  /** 加在浮层上 */
  className?: string
  /** 打开时聚焦第一个带 `data-autofocus` 的元素;没有则聚焦第一个可聚焦元素 */
  children: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// 约定:内容里标了 data-autofocus 的元素优先。例:行列弹层第一个可聚焦的是"减少排数",
// 打开后紧接着按 Enter 会误减一排,所以把 data-autofocus 标在排数输入框上
const firstFocusable = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>('[data-autofocus]') ??
  layer.querySelector<HTMLElement>(FOCUSABLE)

/** 非模态锚定弹层(role="dialog"),渲染在自己的包裹元素里、不用 portal:舞台进全屏时仍可见 */
export default function Popover({
  label,
  trigger,
  triggerProps,
  side = 'bottom',
  align = 'start',
  className,
  children,
}: PopoverProps) {
  const { open, toggle, layerId, wrapperRef, triggerRef, layerRef, onWrapperBlur } =
    useAnchoredLayer(firstFocusable)
  return (
    <div ref={wrapperRef} className="relative inline-flex" onBlur={onWrapperBlur}>
      <Button
        ref={triggerRef}
        type="button"
        {...triggerProps}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={layerId}
        onClick={toggle}
      >
        {trigger}
      </Button>
      {open && (
        <div
          ref={layerRef}
          id={layerId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={layerClass(side, align, className)}
        >
          {children}
        </div>
      )}
    </div>
  )
}
