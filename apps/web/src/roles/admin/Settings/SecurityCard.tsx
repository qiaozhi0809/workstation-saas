import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { SecuritySettings } from '@/shared/types/admin'

const AGES: { value: SecuritySettings['password_max_age_days']; label: string }[] = [
  { value: 0, label: '不限期' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天' },
  { value: 365, label: '365 天' },
]

export default function SecurityCard() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'security-settings'],
    queryFn: adminApi.securitySettings,
  })
  const [draft, setDraft] = useState<SecuritySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (q.isPending) return <LoadingState />
  if (q.isError) {
    return (
      <ErrorState
        title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  }
  const saved = q.data
  const value = draft ?? saved
  const lenValid =
    Number.isInteger(value.password_min_length) &&
    value.password_min_length >= 8 &&
    value.password_min_length <= 32

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await adminApi.saveSecuritySettings(value)
      qc.setQueryData(['admin', 'security-settings'], next)
      void qc.invalidateQueries({ queryKey: ['auth', 'password-policy'] })
      setDraft(null)
      toast('已保存')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card role="group" aria-label="账号安全">
      <CardHeader>
        <CardTitle>账号安全</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            id="sec-totp-allowed"
            aria-label="允许账号开启两步验证"
            className="mt-1"
            checked={value.totp_allowed}
            onChange={(e) => setDraft({ ...value, totp_allowed: e.target.checked })}
          />
          <div className="text-sm">
            <label htmlFor="sec-totp-allowed">允许账号开启两步验证</label>
            <p className="text-xs text-muted-foreground">关闭后已开启的账号仍可正常登录和关闭</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sec-min-length">密码最短长度</Label>
          <Input
            id="sec-min-length"
            type="number"
            min={8}
            max={32}
            className="w-28"
            value={Number.isNaN(value.password_min_length) ? '' : value.password_min_length}
            onChange={(e) => setDraft({ ...value, password_min_length: e.target.valueAsNumber })}
          />
          <p className="text-xs text-muted-foreground">8 到 32 位</p>
          {value.password_min_length > saved.password_min_length && (
            <p className="text-xs text-muted-foreground">已有密码不受影响,下次修改时生效</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="sec-max-age">密码有效期</Label>
          <NativeSelect
            id="sec-max-age"
            value={value.password_max_age_days}
            onChange={(e) =>
              setDraft({
                ...value,
                password_max_age_days: Number(
                  e.target.value,
                ) as SecuritySettings['password_max_age_days'],
              })
            }
          >
            {AGES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" disabled={busy || !lenValid} onClick={() => void save()}>
            保存安全设置
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
