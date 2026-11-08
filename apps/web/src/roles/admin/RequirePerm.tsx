import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/stores/auth'
import { hasPagePerm, type PagePerm } from './perms'

/** 没有该管理权限(perm 为数组时任一即可)就回管理首页 */
export default function RequirePerm({ perm, children }: { perm: PagePerm; children: ReactNode }) {
  const perms = useAuthStore((s) => s.user?.admin_perms)
  if (!hasPagePerm(perms, perm)) return <Navigate to="/admin" replace />
  return <>{children}</>
}
