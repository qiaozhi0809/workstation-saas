import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { RailTip } from './RailTip'

export interface SidebarItem {
  to: string
  label: string
  icon: LucideIcon
}
/** 没有 label = 不显示组标题 */
export interface SidebarGroup {
  key: string
  label?: string
  items: SidebarItem[]
}

export interface SidebarProps {
  groups: SidebarGroup[]
  collapsed: boolean
  onToggle(): void
  /** 权限未到:渲染 navSkeletonRows 行骨架,占住位置 */
  navLoading?: boolean
  navSkeletonRows?: number
  /** 品牌、教师端班级切换 */
  header: ReactNode
  /** 通知铃、主题、账号 */
  footer: ReactNode
  /** 'drawer':放在抽屉里,撑满容器、不浮动 */
  variant?: 'floating' | 'drawer'
}

export function Sidebar({
  groups,
  collapsed,
  onToggle,
  navLoading = false,
  navSkeletonRows = 6,
  header,
  footer,
  variant = 'floating',
}: SidebarProps) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <aside
      aria-label="侧栏"
      data-collapsed={collapsed}
      className={cn(
        'flex shrink-0 flex-col bg-card',
        variant === 'floating'
          ? cn(
              'm-4 h-[calc(100dvh-2rem)] rounded-sidebar shadow-surface',
              collapsed ? 'w-[72px]' : 'w-[264px]',
            )
          : 'min-h-0 w-full flex-1',
      )}
    >
      <div className={cn('flex shrink-0 flex-col gap-2 p-3', collapsed && 'items-center')}>
        {header}
      </div>
      <nav
        aria-label="主导航"
        aria-busy={navLoading || undefined}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto px-3',
          collapsed && 'items-center',
        )}
      >
        {navLoading
          ? Array.from({ length: navSkeletonRows }, (_, i) => (
              <div
                key={i}
                data-nav-skeleton
                aria-hidden="true"
                className={cn(
                  'mb-1 h-10 shrink-0 rounded-md bg-muted',
                  collapsed ? 'w-10' : 'w-full',
                )}
              />
            ))
          : groups.map((g, gi) => (
              <div key={g.key} className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
                {gi > 0 &&
                  (collapsed ? (
                    <div role="separator" className="my-2 h-px w-6 bg-border" />
                  ) : (
                    <div className="h-4 shrink-0" />
                  ))}
                {g.label && !collapsed && (
                  <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{g.label}</h2>
                )}
                {g.items.map((it) => (
                  <SidebarLink key={it.to} item={it} collapsed={collapsed} />
                ))}
              </div>
            ))}
      </nav>
      {variant === 'floating' && (
        <div className={cn('flex shrink-0 px-3 pt-2', collapsed && 'justify-center')}>
          <RailTip label={collapsed ? '展开侧栏' : '折叠侧栏'} disabled={!collapsed}>
            <Button
              variant="ghost"
              size="icon"
              className="touch-target text-muted-foreground"
              aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
              aria-expanded={!collapsed}
              aria-keyshortcuts="["
              onClick={onToggle}
            >
              <ToggleIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
          </RailTip>
        </div>
      )}
      <div
        className={cn(
          'flex shrink-0 gap-1 p-3',
          collapsed ? 'flex-col items-center' : 'items-center',
        )}
      >
        {footer}
      </div>
    </aside>
  )
}

function SidebarLink({ item, collapsed }: { item: SidebarItem; collapsed: boolean }) {
  const { to, label, icon: Icon } = item
  return (
    <RailTip label={label} disabled={!collapsed}>
      // className 必须是字符串:RailTip 的 Tooltip.Trigger asChild 经 Slot 合并 props,函数式
      className 会被拼成源码字符串。 // 当前页由 NavLink 写的 aria-current="page" 驱动样式
      <NavLink
        to={to}
        className={cn(
          'touch-target flex h-10 shrink-0 items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          'aria-[current=page]:bg-accent aria-[current=page]:text-foreground',
          collapsed ? 'w-10 justify-center' : 'w-full px-3',
        )}
      >
        <Icon
          className={cn('shrink-0', collapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4')}
          aria-hidden="true"
        />
        <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
      </NavLink>
    </RailTip>
  )
}
