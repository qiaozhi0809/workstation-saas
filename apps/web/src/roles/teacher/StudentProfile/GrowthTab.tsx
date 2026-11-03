import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sprout } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { growthApi } from '@/shared/api/growth'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { Tone } from '@/shared/lib/tone'
import { GROWTH_TYPES, type GrowthType } from '@/shared/types/growth'
import type { StudentProfile } from '@/shared/types/student'
import ReviewDetail from './ReviewDetail'

/** 类型对应的语义色:表扬 / 获奖偏正向,谈话 / 家访是沟通,提醒需留意 */
// eslint-disable-next-line react-refresh/only-export-components
export const GROWTH_TONE: Record<GrowthType, Tone> = {
  表扬: 'success', 获奖: 'success', 谈话: 'info', 家访: 'info', 提醒: 'warning', 其他: 'neutral',
}

function AddForm({ profile, today }: { profile: StudentProfile; today: string }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<GrowthType>('表扬')
  const [date, setDate] = useState('')
  const [content, setContent] = useState('')
  const add = useMutation({
    mutationFn: () => growthApi.create(profile.id, { type, date: date || today, content: content.trim() }),
    onSuccess: () => {
      setContent('')
      return queryClient.invalidateQueries({ queryKey: ['growth', profile.id] })
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '添加失败,请重试'),
  })
  const submit = () => {
    if (!content.trim() || add.isPending) return
    add.mutate()
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="记录类型" className="h-8" value={type} onChange={(e) => setType(e.target.value as GrowthType)}>
        {GROWTH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </NativeSelect>
      <Input type="date" aria-label="记录日期" className="h-8 w-36" value={date || today} onChange={(e) => setDate(e.target.value)} />
      <Input aria-label="记录内容" maxLength={500} placeholder="记录内容" className="h-8 min-w-40 flex-1" value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
        }} />
      <Button type="button" size="sm" disabled={add.isPending || !content.trim()} onClick={submit}>添加</Button>
    </div>
  )
}

function Timeline({ profile, canWrite }: { profile: StudentProfile; canWrite: boolean }) {
  const queryClient = useQueryClient()
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['growth', profile.id],
    queryFn: () => growthApi.list(profile.id),
  })
  const remove = useMutation({
    mutationFn: (id: string) => growthApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['growth', profile.id] }),
    onError: (err) => toast(err instanceof ApiError ? err.message : '删除失败,请重试'),
  })

  if (error) return <ErrorState title="成长记录加载失败" onRetry={() => void refetch()} retrying={isFetching} />
  if (!data) return <LoadingState />
  if (data.items.length === 0) return <EmptyState icon={Sprout} title="还没有成长记录" />

  return (
    <ul className="space-y-3">
      {data.items.map((r) => (
        <li key={r.id} className="border-b border-border pb-3 text-sm last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{r.date}</span>
            <Badge variant={GROWTH_TONE[r.type]}>{r.type}</Badge>
            {!r.current_year && <span className="text-xs text-muted-foreground">{r.academic_year_name} · {r.class_name}</span>}
            {canWrite && r.can_delete && (
              <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2" disabled={remove.isPending}
                onClick={() => { if (window.confirm('删除这条成长记录?')) remove.mutate(r.id) }}>删除</Button>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{r.content}</p>
        </li>
      ))}
    </ul>
  )
}

export default function GrowthTab({ profile }: { profile: StudentProfile }) {
  const summary = useQuery({
    queryKey: ['classroom', profile.class_id],
    queryFn: () => classroomApi.summary(profile.class_id),
  })
  // 班级信息加载失败要给重试,不能一直卡在加载中
  if (summary.error) return <ErrorState title="加载失败" onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
  if (!summary.data) return <LoadingState />
  const perms = summary.data.my_perms
  const canWrite = perms.includes('growth.write')

  return (
    <div className="space-y-6">
      {perms.includes('growth.read') ? (
        <section>
          {canWrite && <AddForm profile={profile} today={summary.data.today} />}
          <Timeline profile={profile} canWrite={canWrite} />
        </section>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">你在本班没有查看成长记录的权限</p>
      )}
      <ReviewDetail profile={profile} />
    </div>
  )
}
