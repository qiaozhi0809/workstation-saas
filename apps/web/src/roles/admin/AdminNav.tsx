import { NavLink } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { useAuthStore } from '@/shared/stores/auth'
import { ADMIN_PAGES, type AdminPage } from './pages'

/** 管理端顶栏导航:只列当前账号有权限、且不是 hidden 的页面 */
export default function AdminNav({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const perms = useAuthStore((s) => s.user?.admin_perms)
  const links = pages.filter((p) => !p.hidden && perms?.includes(p.perm))
  return (
    <nav aria-label="主导航" className="relative flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {links.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={`/admin/${path}`}
          className={({ isActive }) => cn(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-3',
            isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only md:not-sr-only">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
