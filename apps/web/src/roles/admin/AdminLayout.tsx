import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap } from 'lucide-react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { authApi } from '@/shared/api/auth'
import { Toaster } from '@/shared/components/Toast'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import { Breadcrumb } from '@/shared/components/layout/Breadcrumb'
import { adminCrumbs } from '@/shared/components/layout/crumbs'
import NoticeBell from '@/shared/components/layout/NoticeBell'
import SidebarShell from '@/shared/components/layout/SidebarShell'
import { switchTargets } from '@/shared/components/layout/switchTargets'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { useAuthStore } from '@/shared/stores/auth'
import ThemeToggle from '@/theme/ThemeToggle'
import { adminGroups } from './AdminNav'
import { ADMIN_PAGES, type AdminPage } from './pages'
import { dropUpgradeDraft } from './Upgrade/useUpgradeDraft'

export default function AdminLayout({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = useAuthStore((s) => s.user)
  // 失败时不显示校名
  const school = useQuery({
    queryKey: ['admin', 'school'],
    queryFn: adminApi.school,
    retry: false,
    // GET /admin/school 对任何管理身份可读(协调会话裁定),PUT 仍需 org.manage
    enabled: !!user?.contexts.includes('admin'),
  })
  const groups = useMemo(() => adminGroups(pages, user?.admin_perms), [pages, user?.admin_perms])

  const logout = () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    // 主动退出才清升级向导草稿(L54);会话过期等被动登出不清
    dropUpgradeDraft()
    useAuthStore.getState().logout()
    navigate('/login', { replace: true })
  }

  return (
    <RealtimeProvider>
      <SidebarShell
        scope="default"
        groups={groups}
        navLoading={!user}
        header={(collapsed) => (
          <Link
            to="/admin"
            aria-label={school.data?.name ?? '班级工作台'}
            title={school.data?.name ?? '班级工作台'}
            className="flex min-h-10 min-w-0 items-center gap-2 rounded-md text-foreground"
          >
            <GraduationCap className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {!collapsed && school.data && (
              <span className="truncate font-medium">{school.data.name}</span>
            )}
          </Link>
        )}
        footer={(collapsed) => (
          <>
            <NoticeBell side="top" />
            <ThemeToggle compact />
            <AccountMenu
              name={user?.display_name}
              onLogout={logout}
              switchTo={switchTargets(user?.contexts, 'admin')}
              preferences={false}
              placement="top"
              compact={collapsed}
            />
          </>
        )}
        breadcrumb={<Breadcrumb items={adminCrumbs(pathname, pages)} />}
        overlays={<Toaster />}
      >
        <Outlet />
      </SidebarShell>
    </RealtimeProvider>
  )
}
