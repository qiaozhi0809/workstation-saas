import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { orgApi, type OrgPerson } from './orgApi'

/** 搜索选人:后端只返回在用教师账号,显示姓名、登录名、任教科目 */
export default function PersonPicker({
  value,
  onChange,
}: {
  value: OrgPerson | null
  onChange(a: OrgPerson): void
}) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  const res = useQuery({ queryKey: ['admin', 'org', 'people', q], queryFn: () => orgApi.people(q) })
  const items = res.data ?? []
  return (
    <div className="grid gap-2">
      <Input
        aria-label="搜索账号"
        placeholder="搜索姓名或登录名"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="grid max-h-56 gap-1 overflow-y-auto">
        {items.map((a) => (
          <li key={a.user_id}>
            <button
              type="button"
              aria-pressed={value?.user_id === a.user_id}
              className={cn(
                'flex w-full flex-wrap items-center gap-x-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
                value?.user_id === a.user_id && 'border-primary bg-accent',
              )}
              onClick={() => onChange(a)}
            >
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground">{a.login_name}</span>
              {a.subjects.length > 0 && (
                <span className="text-muted-foreground">{a.subjects.join('、')}</span>
              )}
            </button>
          </li>
        ))}
        {res.isSuccess && items.length === 0 && (
          <li className="text-sm text-muted-foreground">没有找到在用账号</li>
        )}
      </ul>
    </div>
  )
}
