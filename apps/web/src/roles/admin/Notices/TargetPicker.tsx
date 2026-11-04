import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { BoardView, NoticePerson } from '@/shared/types/admin'

export type TargetKind = 'school' | 'grade' | 'class' | 'users'
export const MAX_USERS = 200

const KIND_LABEL: Record<TargetKind, string> = {
  school: '全校老师', grade: '某个年级', class: '某个班', users: '指定的人',
}

function PeoplePicker({ users, onChange }: { users: NoticePerson[]; onChange(next: NoticePerson[]): void }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const found = useQuery({ queryKey: ['notices', 'people', q], queryFn: () => adminApi.noticePeople(q) })
  const chosen = new Set(users.map((u) => u.user_id))
  const full = users.length >= MAX_USERS

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
            <li key={u.user_id} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm">
              {u.name}
              <button type="button" aria-label={`移除 ${u.name}`}
                className="rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onChange(users.filter((x) => x.user_id !== u.user_id))}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 通知对象:全校 / 年级 / 班 / 指定的人。年级、班取自"看全校"接口返回的可见范围,不会列出看不到的年级 */
export default function TargetPicker({
  schoolWide, kind, onKind, board, boardError, onRetryBoard, gradeId, onGrade, classId, onClass, users, onUsers,
}: {
  /** 发送人是否有学校作用域:否(年级组长)则没有"全校老师"选项 */
  schoolWide: boolean
  kind: TargetKind
  onKind(k: TargetKind): void
  /** 当前年级下的看板视图;切换年级加载期间,classes 为空 */
  board: BoardView | undefined
  boardError: boolean
  onRetryBoard(): void
  gradeId: string
  onGrade(id: string): void
  classId: string
  onClass(id: string): void
  users: NoticePerson[]
  onUsers(next: NoticePerson[]): void
}) {
  const kinds: TargetKind[] = [...(schoolWide ? (['school'] as const) : []), 'grade', 'class', 'users']
  const needsBoard = kind === 'grade' || kind === 'class'
  const gradeSelect = (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="w-12 shrink-0">年级</span>
      <NativeSelect aria-label="年级" className="min-w-0 flex-1" value={gradeId} onChange={(e) => onGrade(e.target.value)}>
        {(board?.grades ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </NativeSelect>
    </label>
  )

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-sm">
        <span className="w-12 shrink-0">发给</span>
        <NativeSelect aria-label="发给" className="min-w-0 flex-1" value={kind} onChange={(e) => onKind(e.target.value as TargetKind)}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </NativeSelect>
      </label>
      {needsBoard && boardError && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          可选的年级和班级加载失败
          <Button type="button" variant="outline" size="sm" onClick={onRetryBoard}>重试</Button>
        </p>
      )}
      {needsBoard && !boardError && gradeSelect}
      {kind === 'class' && !boardError && (
        <label className="flex items-center gap-1.5 text-sm">
          <span className="w-12 shrink-0">班级</span>
          <NativeSelect aria-label="班级" className="min-w-0 flex-1" value={classId} onChange={(e) => onClass(e.target.value)}>
            <option value="">请选择班级</option>
            {(board?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </label>
      )}
      {kind === 'users' && <PeoplePicker users={users} onChange={onUsers} />}
    </div>
  )
}
