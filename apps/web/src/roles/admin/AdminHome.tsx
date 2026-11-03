import { Navigate } from 'react-router-dom'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { useAuthStore } from '@/shared/stores/auth'
import { ADMIN_PAGES, type AdminPage } from './pages'

/** /admin 索引:跳到第一个有权限的页面,一个都没有时给空状态 */
export default function AdminHome({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const perms = useAuthStore((s) => s.user?.admin_perms)
  const first = pages.find((p) => !p.hidden && perms?.includes(p.perm))
  if (first) return <Navigate to={first.path} replace />
  return <EmptyState title="你的账号还没有可用的管理功能" className="h-full justify-center p-6" />
}
