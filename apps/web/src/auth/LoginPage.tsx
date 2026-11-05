import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import ThemeToggle from '@/theme/ThemeToggle'
import { clearLoginFlash, peekLoginFlash } from './flash'
import { homeFor } from './home'

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '登录名或密码不正确',
  BAD_REQUEST: '登录名或密码不正确',
  ACCOUNT_LOCKED: '失败次数过多,请 15 分钟后再试',
}
const NO_IDENTITY = '这个账号还没有分配身份,请联系学校信息中心'
const FALLBACK = '登录失败,请稍后再试'

export default function LoginPage() {
  const navigate = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const accessToken = useAuthStore((s) => s.accessToken)
  const signedInUser = useAuthStore((s) => s.user)
  const lastContext = useAuthStore((s) => s.lastContext)
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(peekLoginFlash)

  useEffect(() => {
    clearLoginFlash()
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await authApi.login(loginName.trim(), password)
      if (res.user.contexts.length === 0) {
        // 丢弃令牌前 best-effort 吊销刷新令牌(此时 store 里没有 access token)
        authApi.logout(res.refresh_token).catch(() => {})
        setError(NO_IDENTITY)
        setPending(false)
        return
      }
      setTokens(res.access_token, res.refresh_token, res.user)
      navigate(homeFor(res.user, useAuthStore.getState().lastContext), { replace: true })
    } catch (err) {
      setError((err instanceof ApiError && MESSAGES[err.code]) || FALLBACK)
      setPending(false)
    }
  }

  // 已登录再打开 /login:直接去首页,不再显示登录表单(旧形状存档没有 contexts:照常显示表单,不崩)
  if (
    accessToken &&
    signedInUser &&
    Array.isArray(signedInUser.contexts) &&
    signedInUser.contexts.length > 0
  )
    return <Navigate to={homeFor(signedInUser, lastContext)} replace />

  return (
    <div className="relative grid min-h-full place-items-center bg-muted/40 px-4 pb-8 pt-16">
      <ThemeToggle className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <form onSubmit={onSubmit}>
          <CardHeader>
            <GraduationCap className="h-8 w-8 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight">班级工作台</h1>
            <CardDescription>使用学校分配的账号登录</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-name">登录名</Label>
              <Input
                id="login-name"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">密码</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
              {pending && (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              )}
              {pending ? '登录中…' : '登录'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
