import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'

/** 没有该管理权限就回管理首页 */
export default function RequirePerm({ perm, children }: { perm: AdminPerm; children: ReactNode }) {
  const perms = useAuthStore((s) => s.user?.admin_perms)
  if (!perms?.includes(perm)) return <Navigate to="/admin" replace />
  return <>{children}</>
}
