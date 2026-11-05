import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { AuditActions } from '@/shared/types/admin'

export interface AuditFilterValue {
  from: string
  to: string
  user: { id: string; name: string } | null
  group: string
  deniedOnly: boolean
}

/** 操作人搜索:沿用账号页的账号搜索接口(审计权限的持有者同时有账号管理权限) */
function OperatorSearch({
  value,
  onChange,
}: {
  value: AuditFilterValue['user']
  onChange(u: AuditFilterValue['user']): void
}) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])
  const res = useQuery({
    queryKey: ['admin', 'audit-people', q],
    queryFn: () => adminApi.accounts({ q }),
    enabled: q !== '' && !value,
  })

  if (value) {
    return (
      <span className="flex h-9 items-center gap-1 rounded-md border bg-muted px-2 text-sm">
        {value.name}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="清除操作人"
          onClick={() => {
            onChange(null)
            setText('')
            setQ('')
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </span>
    )
  }
  const items = res.data?.items ?? []
  return (
    <div className="relative">
      <Input
        aria-label="搜索操作人"
        placeholder="搜索操作人姓名或登录名"
        className="w-56"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {q !== '' && res.isSuccess && (
        <ul className="absolute z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-md border bg-background p-1 shadow-md">
          {items.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">没有找到账号</li>
          )}
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-label={`选择 ${a.display_name}(${a.login_name})`}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange({ id: a.id, name: a.display_name })
                  setText('')
                  setQ('')
                }}
              >
                <span className="font-medium">{a.display_name}</span>
                <span className="text-muted-foreground">{a.login_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AuditFilters({
  value,
  actions,
  onChange,
}: {
  value: AuditFilterValue
  actions: AuditActions | undefined
  onChange(patch: Partial<AuditFilterValue>): void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex items-center gap-1.5 text-sm">
        开始
        <Input
          type="date"
          aria-label="开始日期"
          className="w-40"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        结束
        <Input
          type="date"
          aria-label="结束日期"
          className="w-40"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </label>
      <OperatorSearch value={value.user} onChange={(user) => onChange({ user })} />
      <label className="flex items-center gap-1.5 text-sm">
        分组
        <NativeSelect
          aria-label="分组"
          value={value.group}
          onChange={(e) => onChange({ group: e.target.value })}
        >
          <option value="">全部分组</option>
          {actions?.groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={value.deniedOnly}
          onChange={(e) => onChange({ deniedOnly: e.target.checked })}
        />
        只看被拒
      </label>
    </div>
  )
}
