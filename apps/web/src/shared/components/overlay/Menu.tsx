import { createContext, useContext } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import type { PopoverProps } from './Popover'
import { layerClass, useAnchoredLayer } from './useAnchoredLayer'

export type MenuProps = Omit<PopoverProps, 'children'> & { children: ReactNode }

// 菜单项选中后关菜单并还焦点;不导出,避免 react-refresh 规则报错
const CloseMenu = createContext<() => void>(() => {})

const items = (layer: HTMLElement) => Array.from(layer.querySelectorAll<HTMLElement>('[role="menuitem"]'))

// aria-disabled 项:悬停不高亮(免得看着能点);聚焦换成中性的 muted 底色,键盘仍能看出焦点在哪
const ITEM = cn(
  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none',
  'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  'aria-disabled:hover:bg-transparent aria-disabled:hover:text-inherit aria-disabled:focus:bg-muted aria-disabled:focus:text-inherit',
)

/** 菜单按钮(role="menu"):与 Popover 同一套开关与定位,外加 ↑↓ / Home / End 与菜单项 */
export default function Menu({ label, trigger, triggerProps, side = 'bottom', align = 'start', className, children }: MenuProps) {
  const { open, setOpen, close, toggle, layerId, wrapperRef, triggerRef, layerRef, onWrapperBlur } =
    useAnchoredLayer((layer) => items(layer)[0] ?? null)

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    triggerProps?.onKeyDown?.(e)
    if (e.key !== 'ArrowDown' || e.defaultPrevented) return
    e.preventDefault()
    if (open && layerRef.current) items(layerRef.current)[0]?.focus()
    else setOpen(true)
  }

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tab:关闭并让浏览器照常移动焦点(不 preventDefault);焦点先回触发按钮,Tab 从它往后走
    if (e.key === 'Tab') return close(true)
    const list = items(e.currentTarget)
    if (list.length === 0) return
    const at = list.indexOf(document.activeElement as HTMLElement)
    const next = {
      ArrowDown: (at + 1) % list.length,
      ArrowUp: at <= 0 ? list.length - 1 : at - 1,
      Home: 0,
      End: list.length - 1,
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    list[next].focus()
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex" onBlur={onWrapperBlur}>
      <Button ref={triggerRef} type="button" {...triggerProps}
        aria-haspopup="menu" aria-expanded={open} aria-controls={layerId} onClick={toggle} onKeyDown={onTriggerKeyDown}>
        {trigger}
      </Button>
      {open && (
        <CloseMenu.Provider value={() => close(true)}>
          <div ref={layerRef} id={layerId} role="menu" aria-label={label} tabIndex={-1}
            className={layerClass(side, align, cn('flex min-w-32 flex-col', className))} onKeyDown={onMenuKeyDown}>
            {children}
          </div>
        </CloseMenu.Provider>
      )}
    </div>
  )
}

export function MenuItem({ onSelect, disabled, children }: { onSelect(): void; disabled?: boolean; children: ReactNode }) {
  const closeMenu = useContext(CloseMenu)
  return (
    <button type="button" role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} className={ITEM}
      onClick={() => {
        // aria-disabled 而非 disabled:仍可用方向键聚焦,点了不执行、菜单不关
        if (disabled) return
        // 先关菜单、还焦点,再执行:onSelect 若打开对话框,对话框记下的"打开前焦点"就是触发按钮,
        // 也不会被随后的还焦点抢走
        closeMenu()
        onSelect()
      }}>
      {children}
    </button>
  )
}

export function MenuLinkItem({ to, children }: { to: string; children: ReactNode }) {
  const closeMenu = useContext(CloseMenu)
  // Link 先执行这里的 onClick,再导航
  return <Link to={to} role="menuitem" tabIndex={-1} className={ITEM} onClick={closeMenu}>{children}</Link>
}

/** 菜单里的一行弱化文字(如当前用户名),不是菜单项 */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">{children}</div>
}
