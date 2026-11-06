import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { AuditActions } from '@/shared/types/admin'
import { OBJECT_TYPE_LABELS } from './objectTypes'

export interface AuditFilterValue {
  from: string
  to: string
  user: { id: string; name: string } | null
  group: string
  /** 具体动作(后端 action);空串 = 不限 */
  action: string
  /** 对象类型(后端 object_type);空串 = 不限 */
  objectType: string
  deniedOnly: boolean
}

/**
 * 操作人搜索:沿用账号页的账号搜索接口(审计权限的持有者同时有账号管理权限)。
 * 结果按页取,超过一页时可"加载更多"(L59);焦点移出组件、点到组件外或按 Esc 时收起下拉,
 * 回到输入框再展开。
 */
function OperatorSearch({
  value,
  onChange,
}: {
  value: AuditFilterValue['user']
  onChange(u: AuditFilterValue['user']): void
}) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])
  // 点到组件外:点的是不可聚焦的地方时 blur 的 relatedTarget 为空,靠这里收起(与 useAnchoredLayer 同思路)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])
  const res = useInfiniteQuery({
    queryKey: ['admin', 'audit-people', q],
    queryFn: ({ pageParam }) => adminApi.accounts({ q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.items.length, 0) < last.total ? pages.length + 1 : undefined,
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
  const items = res.data?.pages.flatMap((p) => p.items) ?? []
  const total = res.data?.pages[0]?.total ?? 0
  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        // 焦点移到组件外才收起;移到"加载更多"等组件内的按钮上不算
        const next = e.relatedTarget
        if (!(next instanceof Node && e.currentTarget.contains(next))) setOpen(false)
      }}
    >
      <Input
        aria-label="搜索操作人"
        placeholder="搜索操作人姓名或登录名"
        className="w-56"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && q !== '' && res.isSuccess && (
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
                  setOpen(false)
                }}
              >
                <span className="font-medium">{a.display_name}</span>
                <span className="text-muted-foreground">{a.login_name}</span>
              </button>
            </li>
          ))}
          {res.hasNextPage && (
            <li>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-accent disabled:opacity-50"
                disabled={res.isFetchingNextPage}
                onClick={() => void res.fetchNextPage()}
              >
                {`加载更多(还有 ${total - items.length} 个)`}
              </button>
            </li>
          )}
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
  // 选了分组就只列该组的动作;"被拒的访问"这类按结果归类的组没有具体动作
  const actionGroups = (actions?.groups ?? []).filter(
    (g) => g.actions.length > 0 && (!value.group || g.key === value.group),
  )
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
          // 换分组时清掉具体动作:原来选的多半不在新组里
          onChange={(e) => onChange({ group: e.target.value, action: '' })}
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
        操作
        <NativeSelect
          aria-label="操作"
          value={value.action}
          onChange={(e) => onChange({ action: e.target.value })}
        >
          <option value="">全部操作</option>
          {actionGroups.length === 1
            ? actionGroups[0].actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label}
                </option>
              ))
            : actionGroups.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.actions.map((a) => (
                    <option key={a.action} value={a.action}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
        </NativeSelect>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        对象类型
        <NativeSelect
          aria-label="对象类型"
          value={value.objectType}
          onChange={(e) => onChange({ objectType: e.target.value })}
        >
          <option value="">全部对象</option>
          {Object.entries(OBJECT_TYPE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
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
