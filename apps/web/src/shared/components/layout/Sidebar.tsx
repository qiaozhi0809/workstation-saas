import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link, matchPath, useLocation } from 'react-router-dom'
import { IconButton } from '@/shared/components/ui/icon-button'
import { cn } from '@/shared/lib/utils'
import { RailTip } from './RailTip'

export interface SidebarItem {
  to: string
  label: string
  icon: LucideIcon
  /** 也算「当前页」的路径模式(react-router 写法,如 `/admin/classes/:id`):导航里没有入口的子页挂在这一项下 */
  alsoActive?: string[]
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
          // 导航超过一屏时在这里滚动:底部留 16 的内边距、再用渐隐遮住贴着底部按钮区的那一截,
          // 既不会让最后一项被压在按钮区下面,也提示下面还有内容(滚到底时渐隐只落在空白内边距上)
          'flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 [mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]',
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
            <IconButton
              icon={ToggleIcon}
              className="touch-target text-muted-foreground"
              aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
              aria-expanded={!collapsed}
              aria-keyshortcuts="["
              onClick={onToggle}
            />
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
  const { to, label, icon: Icon, alsoActive } = item
  const { pathname } = useLocation()
  // 前提:侧栏没有根路径(`to="/"`)项。matchPath({ end: false }) 对 "/" 会匹配所有路径,
  // 将来要加根路径项,得对它单独用 end: true
  const current =
    matchPath({ path: to, end: false }, pathname) !== null ||
    (alsoActive ?? []).some((p) => matchPath({ path: p, end: false }, pathname) !== null)
  // className 必须是字符串:RailTip 的 Tooltip.Trigger asChild 经 Slot 合并 props,
  // 函数式 className 会被拼成源码字符串;当前页由 aria-current="page" 驱动样式
  return (
    <RailTip label={label} disabled={!collapsed}>
      <Link
        to={to}
        aria-current={current ? 'page' : undefined}
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
      </Link>
    </RailTip>
  )
}
