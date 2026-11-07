import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { schoolApi } from '@/shared/api/school'
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card'
import { ChangePasswordForm } from '@/shared/components/layout/ChangePasswordDialog'
import { META_QUERY_KEY } from '@/shared/hooks/useSchoolTz'
import { useAuthStore } from '@/shared/stores/auth'
import type { User } from '@/shared/types/user'
import ThemeToggle from '@/theme/ThemeToggle'
import { homeFor } from './home'

type Reason = NonNullable<User['password_change_reason']>

/** 原因说明:首次登录 / 已过期各有文案;'required'(前端兜底)或将来后端新增的值一律中性文案,不冒充前两者 */
function ReasonNote({ reason }: { reason: Reason }) {
  const policy = useQuery({
    queryKey: ['auth', 'password-policy'],
    queryFn: authApi.passwordPolicy,
    staleTime: 60_000,
  })
  const days = policy.data?.max_age_days
  if (reason === 'first_login') return <p className="text-sm">首次登录请设置新密码</p>
  if (reason !== 'expired') return <p className="text-sm">管理员要求你先修改密码</p>
  return (
    <p className="text-sm">
      {days ? `密码已超过 ${days} 天未更换,请设置新密码` : '密码已过期,请设置新密码'}
    </p>
  )
}

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const lastContext = useAuthStore((s) => s.lastContext)
  const mustChange = !!accessToken && (!user || user.must_change_password)
  // 挂载时重取一次 /auth/me(L307):client.ts 兜底写进 store 的 'required' 只是占位,换成服务端的真实原因,
  // 并拿到最新的 must_change_password(在别处已改过就直接回首页)。取不到就沿用本地的,不报错。
  // 只取一次:自己 setUser 之后 user 变了也不再取(StrictMode 下 ref 也不会被重置)
  const refetched = useRef(false)
  useEffect(() => {
    if (refetched.current || !mustChange) return
    refetched.current = true
    authApi
      .me()
      .then((me) => {
        if (me && typeof me === 'object') useAuthStore.getState().setUser(me)
      })
      .catch(() => {
        /* 沿用本地的原因 */
      })
  }, [mustChange])
  // 校名来自 /meta;V3-3 合并前它在强制改密中 403——读不到就不显示,不报错也不重试
  const meta = useQuery({
    queryKey: META_QUERY_KEY,
    queryFn: schoolApi.meta,
    staleTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: mustChange,
  })
  if (!accessToken) return <Navigate to="/login" replace />
  if (user && !user.must_change_password)
    return <Navigate to={homeFor(user, lastContext)} replace />

  const onSuccess = async () => {
    // 密码此时已改成功;me() 失败不能当作"修改失败",回退为本地置 must_change_password=false
    let user: User | null = null
    try {
      user = await authApi.me()
    } catch {
      /* 回退 */
    }
    if (!user) {
      const cur = useAuthStore.getState().user
      if (!cur) {
        navigate('/login', { replace: true })
        return
      }
      user = { ...cur, must_change_password: false, password_change_reason: null }
    }
    useAuthStore.getState().setUser(user)
    navigate(homeFor(user, useAuthStore.getState().lastContext), { replace: true })
  }

  const reason = user?.password_change_reason

  return (
    <div className="relative grid min-h-full place-items-center bg-muted/40 px-4 pb-8 pt-16">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <KeyRound className="h-8 w-8 text-primary" aria-hidden="true" />
          {meta.data?.school_name && (
            <p className="text-sm text-muted-foreground">{meta.data.school_name}</p>
          )}
          <h1 className="text-xl font-semibold tracking-tight">
            {reason === 'first_login' ? '首次登录请先修改密码' : '请先修改密码'}
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason && <ReasonNote reason={reason} />}
          <ChangePasswordForm onSuccess={onSuccess} />
        </CardContent>
      </Card>
    </div>
  )
}
