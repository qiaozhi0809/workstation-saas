import { Bell, CalendarDays, ClipboardList, Sprout, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { inboxUnread, useInbox } from '@/shared/components/notices/useInbox'
import { cn } from '@/shared/lib/utils'

const TABS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: 'today', label: '今日', icon: CalendarDays },
  { path: 'growth', label: '成长', icon: Sprout },
  { path: 'grades', label: '成绩', icon: ClipboardList },
  { path: 'notices', label: '通知', icon: Bell },
]

/** < 768 底部固定页签(图标在上文字在下,避开 iOS 安全区);≥ 768 放进顶栏 */
export default function ParentNav({
  placement,
  childId,
}: {
  placement: 'bottom' | 'top'
  childId: string
}) {
  const bottom = placement === 'bottom'
  // 与通知页同一份收件箱缓存;未读徽标按全量(每页响应都带);事件失效在 ParentLayout
  const unread = inboxUnread(useInbox().data)
  const search = `?child=${encodeURIComponent(childId)}`
  return (
    <nav
      aria-label="主导航"
      className={cn(
        'flex',
        bottom
          ? 'shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]'
          : 'items-center gap-1',
      )}
    >
      {TABS.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={{ pathname: `/parent/${path}`, search }}
          className={({ isActive }) =>
            cn(
              'flex min-h-[44px] items-center justify-center rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              bottom
                ? 'min-w-[44px] flex-1 flex-col gap-0.5 py-1 text-xs'
                : 'min-w-[44px] gap-1.5 px-3',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              !bottom && isActive && 'bg-accent',
            )
          }
        >
          <span className="relative">
            <Icon className="h-5 w-5" aria-hidden="true" />
            {path === 'notices' && unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
          <span>{label}</span>
          {path === 'notices' && unread > 0 && (
            <span className="sr-only">{`${unread} 条未读`}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
