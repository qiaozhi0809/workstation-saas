import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { authApi } from '@/shared/api/auth'
import { Toaster } from '@/shared/components/Toast'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import AppShell from '@/shared/components/layout/AppShell'
import NoticeBell from '@/shared/components/layout/NoticeBell'
import { switchTargets } from '@/shared/components/layout/switchTargets'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { useAuthStore } from '@/shared/stores/auth'
import ThemeToggle from '@/theme/ThemeToggle'
import AdminNav from './AdminNav'
import { ADMIN_PAGES, type AdminPage } from './pages'

export default function AdminLayout({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  // 失败时不显示校名
  const school = useQuery({ queryKey: ['admin', 'school'], queryFn: adminApi.school, retry: false,
    // GET /admin/school 对任何管理身份可读(协调会话裁定),PUT 仍需 org.manage
    enabled: !!user?.contexts.includes('admin'),
  })

  const logout = () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    navigate('/login', { replace: true })
  }

  return (
    <RealtimeProvider>
      <AppShell
        home="/admin"
        context={school.data ? <span className="truncate font-medium">{school.data.name}</span> : undefined}
        nav={<AdminNav pages={pages} />}
        actions={(
          <>
            <NoticeBell />
            <ThemeToggle />
            <AccountMenu name={user?.display_name} onLogout={logout} switchTo={switchTargets(user?.contexts, 'admin')} preferences={false} />
          </>
        )}
        overlays={<Toaster />}
      >
        <Outlet />
      </AppShell>
    </RealtimeProvider>
  )
}
