import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import { kindsFor } from './targetKinds'
import type { Audience, NoticeOptions, NoticePerson } from '@/shared/types/admin'

export type TargetKind = 'school' | 'grade' | 'class' | 'users'
export const MAX_USERS = 200

const KIND_LABEL: Record<Audience, Record<TargetKind, string>> = {
  teachers: { school: '全校老师', grade: '某个年级', class: '某个班', users: '指定的人' },
  parents: { school: '全校家长', grade: '某个年级', class: '某个班', users: '指定的人' },
}

function PeoplePicker({ users, onChange, unavailable, unavailableMessage }: {
  users: NoticePerson[]
  onChange(next: NoticePerson[]): void
  /** 发送返回 409 时,已不可选的 user_id */
  unavailable: ReadonlySet<string>
  unavailableMessage: string
}) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const found = useQuery({ queryKey: ['notices', 'people', q], queryFn: () => adminApi.noticePeople(q) })
  const chosen = new Set(users.map((u) => u.user_id))
  const full = users.length >= MAX_USERS
  const badIds = users.filter((u) => unavailable.has(u.user_id)).map((u) => u.user_id)

  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="搜索姓名或登录名" placeholder="搜索姓名或登录名" value={search} onChange={(e) => setSearch(e.target.value)} />
      {found.isError ? (
        <p role="alert" className="text-sm text-destructive">{found.error instanceof ApiError ? found.error.message : '搜索失败,请重试'}</p>
      ) : !found.data ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : found.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有符合条件的人</p>
      ) : (
        <ul aria-label="搜索结果" className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {found.data.map((p) => {
            const on = chosen.has(p.user_id)
            return (
              <li key={p.user_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.name}</span>
                  {p.tags.length > 0 && <span className="ml-2 text-muted-foreground">{p.tags.join('、')}</span>}
                </span>
                <Button type="button" variant="outline" size="sm" disabled={on || full}
                  aria-label={`${on ? '已选' : '添加'} ${p.name}`}
                  onClick={() => onChange([...users, p])}>
                  {on ? '已选' : '添加'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{`已选 ${users.length} 人(最多 ${MAX_USERS} 人)`}</p>
      {users.length > 0 && (
        <ul aria-label="已选择的人" className="flex flex-wrap gap-1.5">
          {users.map((u) => (
            <li key={u.user_id}
              className={cn('inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm',
                unavailable.has(u.user_id) && 'bg-destructive/10 text-destructive')}>
              {u.name}
              {unavailable.has(u.user_id) && <span className="text-xs">已不可选</span>}
              <button type="button" aria-label={`移除 ${u.name}`}
                className="rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onChange(users.filter((x) => x.user_id !== u.user_id))}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {unavailableMessage && <p role="alert" className="text-sm text-destructive">{unavailableMessage}</p>}
      {badIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm"
            onClick={() => onChange(users.filter((u) => !unavailable.has(u.user_id)))}>
            去掉这些人
          </Button>
        </div>
      )}
    </div>
  )
}

/** 通知对象:全校 / 年级 / 班 / 指定的人(家长对象没有"指定的人")。年级、班取自 noticeOptions,不会列出发不了的年级 */
export default function TargetPicker({
  audience, options, kind, onKind, gradeId, onGrade, classId, onClass, users, onUsers, unavailable, unavailableMessage,
}: {
  audience: Audience
  /** 发送人可选的范围;school_wide=false(年级组长)则没有"全校"选项 */
  options: NoticeOptions
  kind: TargetKind
  onKind(k: TargetKind): void
  gradeId: string
  onGrade(id: string): void
  classId: string
  onClass(id: string): void
  users: NoticePerson[]
  onUsers(next: NoticePerson[]): void
  unavailable: ReadonlySet<string>
  unavailableMessage: string
}) {
  const kinds = kindsFor(audience, options.school_wide)
  const needsGrade = kind === 'grade' || kind === 'class'
  const gradeSelect = (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="w-12 shrink-0">年级</span>
      <NativeSelect aria-label="年级" className="min-w-0 flex-1" value={gradeId} onChange={(e) => onGrade(e.target.value)}>
        {options.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </NativeSelect>
    </label>
  )

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-sm">
        <span className="w-12 shrink-0">发给</span>
        <NativeSelect aria-label="发给" className="min-w-0 flex-1" value={kind} onChange={(e) => onKind(e.target.value as TargetKind)}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[audience][k]}</option>)}
        </NativeSelect>
      </label>
      {needsGrade && gradeSelect}
      {kind === 'class' && (
        <label className="flex items-center gap-1.5 text-sm">
          <span className="w-12 shrink-0">班级</span>
          <NativeSelect aria-label="班级" className="min-w-0 flex-1" value={classId} onChange={(e) => onClass(e.target.value)}>
            <option value="">请选择班级</option>
            {options.classes.filter((c) => c.grade_id === gradeId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </label>
      )}
      {kind === 'users' && (
        <PeoplePicker users={users} onChange={onUsers} unavailable={unavailable} unavailableMessage={unavailableMessage} />
      )}
    </div>
  )
}
