import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { orgApi, type OrgPerson } from '../Org/orgApi'

export const UNKNOWN = '(未知账号)'

export interface Picked {
  id: string
  name: string
}

function Candidates({ chosen, onToggle }: { chosen: Set<string>; onToggle(p: OrgPerson): void }) {
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
              aria-pressed={chosen.has(a.user_id)}
              className={cn(
                'flex w-full flex-wrap items-center gap-x-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
                chosen.has(a.user_id) && 'border-primary bg-accent',
              )}
              onClick={() => onToggle(a)}
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
        {res.isError && (
          <li role="alert" className="text-sm text-destructive">
            账号列表加载失败
          </li>
        )}
      </ul>
    </div>
  )
}

/** 选人:单选(班主任)选中即关闭;多选(年级组长)在弹窗里勾选后点"完成" */
export default function PersonSelect({
  label,
  selected,
  multiple = false,
  invalid = false,
  emptyText,
  onChange,
}: {
  label: string
  selected: Picked[]
  multiple?: boolean
  invalid?: boolean
  emptyText: string
  onChange(next: Picked[]): void
}) {
  const [open, setOpen] = useState(false)
  const chosen = new Set(selected.map((p) => p.id))
  const toggle = (a: OrgPerson) => {
    const one = { id: a.user_id, name: a.name }
    if (!multiple) {
      onChange([one])
      setOpen(false)
      return
    }
    onChange(chosen.has(one.id) ? selected.filter((p) => p.id !== one.id) : [...selected, one])
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {multiple &&
        selected.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm"
          >
            {p.name}
            <button
              type="button"
              aria-label={`移除 ${label} ${p.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(selected.filter((x) => x.id !== p.id))}
            >
              ×
            </button>
          </span>
        ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(invalid && 'border-destructive text-destructive')}
        onClick={() => setOpen(true)}
      >
        {multiple ? '添加' : (selected[0]?.name ?? emptyText)}
      </Button>
      {!multiple && selected.length > 0 && (
        <button
          type="button"
          aria-label={`清除 ${label}`}
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => onChange([])}
        >
          清除
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`选择:${label}`}
        className="max-w-md"
      >
        <div className="grid gap-3">
          <Candidates chosen={chosen} onToggle={toggle} />
          {multiple && (
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>完成</Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
