import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { Button } from '@/shared/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import type { LoginResponse } from '@/shared/types/api'

const MESSAGES: Record<string, string> = {
  TOTP_INVALID: '验证码不正确',
  ACCOUNT_LOCKED: '失败次数过多,请 15 分钟后再试',
}
const FALLBACK = '验证失败,请稍后再试'

/** 登录第二步。mfa_token 只存在于组件 props / 内存,不写任何持久存储、也不进 URL */
export default function TotpStep({
  mfaToken,
  onDone,
  onExpired,
  onBack,
}: {
  mfaToken: string
  onDone(res: LoginResponse): void | Promise<void>
  onExpired(): void
  onBack(): void
}) {
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (value: string) => {
    setError(null)
    setPending(true)
    try {
      const res = await authApi.loginTotp(mfaToken, value)
      await onDone(res)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_EXPIRED') {
        onExpired()
        return
      }
      setError((err instanceof ApiError && MESSAGES[err.code]) || FALLBACK)
      setCode('')
      setPending(false)
      inputRef.current?.focus()
    }
  }

  const onChange = (raw: string) => {
    if (pending) return
    const v = raw.replace(/\D/g, '').slice(0, 6)
    setCode(v)
    if (v.length === 6) void submit(v)
  }

  return (
    <>
      <CardHeader>
        <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight">两步验证</h1>
        <CardDescription>请输入验证器应用里显示的 6 位数字</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="totp-code">验证码</Label>
          <Input
            id="totp-code"
            ref={inputRef}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            readOnly={pending}
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
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          返回重新登录
        </Button>
      </CardFooter>
    </>
  )
}
