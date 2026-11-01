import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '登录名或密码不正确',
  ACCOUNT_LOCKED: '失败次数过多,请 15 分钟后再试',
}
const FALLBACK = '登录失败,请稍后再试'

export default function LoginPage() {
  const navigate = useNavigate()
  const setTokens = useAuthStore((s) => s.setTokens)
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await authApi.login(loginName.trim(), password)
      setTokens(res.access_token, res.refresh_token, res.user)
      navigate('/teacher', { replace: true })
    } catch (err) {
      setError((err instanceof ApiError && MESSAGES[err.code]) || FALLBACK)
      setPending(false)
    }
  }

  return (
    <div className="min-h-full grid place-items-center bg-fill">
      <form onSubmit={onSubmit} className="bg-panel p-8 rounded-xl shadow-md w-80 space-y-4">
        <h1 className="text-lg font-semibold">班级工作台 · 登录</h1>
        <label className="block text-sm">
          登录名
          <input
            className="mt-1 w-full rounded border border-line-2 px-3 py-2"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block text-sm">
          密码
          <input
            type="password"
            className="mt-1 w-full rounded border border-line-2 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded bg-blue text-white py-2 disabled:opacity-60">
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
