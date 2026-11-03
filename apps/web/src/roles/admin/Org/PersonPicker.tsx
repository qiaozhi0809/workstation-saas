import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { Account } from '@/shared/types/admin'

/** 搜索账号选人:只列在用账号,显示姓名、登录名、任教科目 */
export default function PersonPicker({ value, onChange }: { value: Account | null; onChange(a: Account): void }) {
  const [q, setQ] = useState('')
  const filters = { q: q.trim(), status: 'active' }
  const res = useQuery({ queryKey: ['admin', 'accounts', filters], queryFn: () => adminApi.accounts(filters) })
  const items = (res.data?.items ?? []).filter((a) => a.status === 'active')
  return (
    <div className="grid gap-2">
      <Input aria-label="搜索账号" placeholder="搜索姓名或登录名" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="grid max-h-56 gap-1 overflow-y-auto">
        {items.map((a) => (
          <li key={a.id}>
            <button type="button" aria-pressed={value?.id === a.id}
              className={cn('flex w-full flex-wrap items-center gap-x-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
                value?.id === a.id && 'border-primary bg-accent')}
              onClick={() => onChange(a)}>
              <span className="font-medium">{a.display_name}</span>
              <span className="text-muted-foreground">{a.login_name}</span>
              {a.subjects.length > 0 && <span className="text-muted-foreground">{a.subjects.join('、')}</span>}
            </button>
          </li>
        ))}
        {res.isSuccess && items.length === 0 && <li className="text-sm text-muted-foreground">没有找到在用账号</li>}
      </ul>
    </div>
  )
}
