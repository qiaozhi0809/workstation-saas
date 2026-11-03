import { KeyRound } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card'
import { ChangePasswordForm } from '@/shared/components/layout/ChangePasswordDialog'
import { useAuthStore } from '@/shared/stores/auth'
import ThemeToggle from '@/theme/ThemeToggle'
import { homeFor } from './home'

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  if (!accessToken) return <Navigate to="/login" replace />

  const onSuccess = async () => {
    const user = await authApi.me()
    useAuthStore.getState().setUser(user)
    navigate(homeFor(user, useAuthStore.getState().lastContext), { replace: true })
  }

  return (
    <div className="relative grid min-h-full place-items-center bg-muted/40 px-4 pb-8 pt-16">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <KeyRound className="h-8 w-8 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">首次登录请先修改密码</h1>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm onSuccess={onSuccess} />
        </CardContent>
      </Card>
    </div>
  )
}
