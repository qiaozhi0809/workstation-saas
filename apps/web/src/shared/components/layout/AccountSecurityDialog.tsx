import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Copy, Loader2 } from 'lucide-react'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useAuthStore } from '@/shared/stores/auth'
import type { TotpSetup } from '@/shared/types/api'

const CODE_MESSAGES: Record<string, string> = {
  WRONG_PASSWORD: '密码不正确',
  INVALID_CREDENTIALS: '密码不正确',
  ACCOUNT_LOCKED: '尝试次数过多,请稍后再试',
  TOTP_INVALID: '验证码不正确或已过期,请检查手机时间',
  TOTP_SETUP_EXPIRED: '二维码已过期,请重新开启',
}
const errText = (err: unknown) =>
  err instanceof ApiError ? (CODE_MESSAGES[err.code] ?? err.message) : '操作失败,请稍后再试'

/** 手动输入用的密钥:每 4 位一组 */
const groupSecret = (s: string) => s.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

function EnableFlow({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('') // 只在组件状态里,关闭对话框即卸载清空;不持久化、不记录
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(true)

  const begin = () => {
    setStarting(true)
    authApi
      .totpSetup()
      .then(setSetup)
      .catch((err) => setError(errText(err)))
      .finally(() => setStarting(false))
  }

  // 进入即生成(服务端每次生成都会覆盖待确认的密钥,所以只发一次)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    begin()
  }, [])

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await authApi.totpEnable(code, password, useAuthStore.getState().refreshToken ?? '')
      setPassword('')
      toast('已开启两步验证')
      onDone()
    } catch (err) {
      setError(errText(err))
      setPassword('')
      setBusy(false)
      if (err instanceof ApiError && err.code === 'TOTP_SETUP_EXPIRED') {
        setSetup(null)
        setCode('')
        begin()
      }
    }
  }

  const copy = () => {
    if (!setup) return
    void navigator.clipboard
      ?.writeText(setup.secret)
      .then(() => toast('已复制'))
      .catch(() => toast('复制失败,请手动选取'))
  }

  if (!setup) {
    return (
      <div className="space-y-3">
        <ErrorLine message={error} />
        {starting && <LoadingState />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          {!starting && error && (
            <Button
              type="button"
              onClick={() => {
                setError(null)
                begin()
              }}
            >
              重试
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-sm">用验证器应用扫描二维码,或手动输入下面的密钥。</p>
      <img
        alt="两步验证二维码"
        className="mx-auto h-44 w-44 rounded border p-1"
        // 二维码必须白底黑码才扫得出来,深色主题下也不能跟随主题色
        style={{ backgroundColor: 'Canvas', color: 'CanvasText', colorScheme: 'light' }}
        src={'data:image/svg+xml;utf8,' + encodeURIComponent(setup.qr_svg)}
      />
      <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
        <code className="break-all text-sm tracking-wide">{groupSecret(setup.secret)}</code>
        <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label="复制密钥">
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="totp-enable-code">验证码</Label>
        <Input
          id="totp-enable-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="totp-enable-pw">当前密码</Label>
        <Input
          id="totp-enable-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <ErrorLine message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy || code.length !== 6 || !password} aria-busy={busy}>
          {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          确认开启
        </Button>
      </div>
    </form>
  )
}

function DisableFlow({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await authApi.totpDisable(password)
      toast('已关闭两步验证')
      onDone()
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="totp-disable-pw">当前密码</Label>
        <Input
          id="totp-disable-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <ErrorLine message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="destructive" disabled={busy || !password} aria-busy={busy}>
          {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          确认关闭
        </Button>
      </div>
    </form>
  )
}

function Body() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['auth', 'totp'], queryFn: authApi.totpStatus })
  const [mode, setMode] = useState<'view' | 'enable' | 'disable'>('view')
  const refresh = useMutation({
    mutationFn: () => qc.invalidateQueries({ queryKey: ['auth', 'totp'] }),
  })
  const done = () => {
    setMode('view')
    refresh.mutate()
  }

  if (q.isPending) return <LoadingState />
  if (q.isError) {
    return (
      <ErrorState
        title={errText(q.error)}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  }
  const { allowed, enabled } = q.data

  if (mode === 'enable') return <EnableFlow onDone={done} onCancel={() => setMode('view')} />
  if (mode === 'disable') return <DisableFlow onDone={done} onCancel={() => setMode('view')} />

  if (!enabled && !allowed) {
    return <p className="text-sm text-muted-foreground">学校未开启两步验证</p>
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm">
        <p className="font-medium">两步验证</p>
        <p className="text-muted-foreground">{enabled ? '已开启' : '未开启'}</p>
      </div>
      {enabled ? (
        <Button type="button" variant="outline" onClick={() => setMode('disable')}>
          关闭两步验证
        </Button>
      ) : (
        <Button type="button" onClick={() => setMode('enable')}>
          开启
        </Button>
      )}
    </div>
  )
}

/** 账号安全:本人开启 / 关闭两步验证。教师端、管理端、家长端共用(经 AccountMenu) */
export default function AccountSecurityDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose(): void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="账号安全"
      dismissOnOutside={false}
      className="max-w-sm"
    >
      {/* 打开时才挂载:关闭即清空二维码与输入 */}
      {open && <Body />}
    </Modal>
  )
}
