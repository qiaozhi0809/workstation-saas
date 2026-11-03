import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { contextHome } from '@/auth/home'
import { useAuthStore } from '@/shared/stores/auth'
import type { Context } from '@/shared/types/admin'

export default function ProtectedRoute({ children, context }: { children: ReactNode; context?: Context }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  if (!accessToken) return <Navigate to="/login" replace />
  // 旧形状存档(无 contexts)的防御:清登录态回登录页
  if (!Array.isArray(user?.contexts)) {
    useAuthStore.getState().logout()
    return <Navigate to="/login" replace />
  }
  if (user?.must_change_password) return <Navigate to="/change-password" replace />
  if (context && user && !user.contexts.includes(context)) {
    const first = user.contexts[0]
    return <Navigate to={first ? contextHome(first) : '/login'} replace />
  }
  return <>{children}</>
}
