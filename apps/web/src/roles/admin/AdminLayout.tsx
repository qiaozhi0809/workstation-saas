import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { authApi } from '@/shared/api/auth'
import { Toaster } from '@/shared/components/Toast'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import AppShell from '@/shared/components/layout/AppShell'
import { useAuthStore } from '@/shared/stores/auth'
import ThemeToggle from '@/theme/ThemeToggle'
import AdminNav from './AdminNav'
import { ADMIN_PAGES, type AdminPage } from './pages'

export default function AdminLayout({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  // 失败时不显示校名
  const school = useQuery({ queryKey: ['admin', 'school'], queryFn: adminApi.school, retry: false })

  const logout = () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    navigate('/login', { replace: true })
  }

  const switchTo = user?.contexts.includes('teacher') ? { label: '切换到教师端', to: '/teacher' } : undefined

  return (
    <AppShell
      home="/admin"
      context={school.data ? <span className="truncate font-medium">{school.data.name}</span> : undefined}
      nav={<AdminNav pages={pages} />}
      actions={(
        <>
          <ThemeToggle />
          <AccountMenu name={user?.display_name} onLogout={logout} switchTo={switchTo} preferences={false} />
        </>
      )}
      overlays={<Toaster />}
    >
      <Outlet />
    </AppShell>
  )
}
