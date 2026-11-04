import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import type { Switches } from '@/shared/types/admin'

const PARENT_NOTE = '家长端上线后生效'
const MONITOR_NOTE = '监控上线后生效'

const GROUPS: { title: string; items: { key: keyof Switches; label: string; note?: string }[] }[] = [
  { title: '教室', items: [
    { key: 'star_of_week', label: '本周之星' },
    { key: 'birthdays', label: '本月寿星' },
    { key: 'teacher_review_frequency', label: '教师可见互相的点评频率' },
  ] },
  { title: '家长端', items: [
    { key: 'parent_rank', label: '家长可见排名', note: PARENT_NOTE },
    { key: 'parent_negative_review', label: '家长收到负向点评', note: PARENT_NOTE },
    { key: 'ai_review_before_send', label: 'AI 内容需审核后下发', note: PARENT_NOTE },
  ] },
  { title: '监控', items: [
    { key: 'monitor', label: '监控模块总开关', note: MONITOR_NOTE },
    { key: 'parent_monitor', label: '家长可看监控', note: 'v1 不开放' },
  ] },
]

export default function SwitchesCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'switches'], queryFn: adminApi.switches })
  const [draft, setDraft] = useState<Switches | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (q.isPending) return <LoadingState />
  if (q.isError) {
    return <ErrorState title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
      onRetry={() => void q.refetch()} retrying={q.isFetching} />
  }
  const value = draft ?? q.data

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      // 家长可看监控 v1 不开放,永远存 false
      const saved = await adminApi.saveSwitches({ ...value, parent_monitor: false })
      qc.setQueryData(['admin', 'switches'], saved)
      setDraft(null)
      // 教室概况带着开关,让老师端不刷新页面也能生效
      void qc.invalidateQueries({ queryKey: ['classroom'] })
      toast('已保存')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>功能开关</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {GROUPS.map((g) => (
          <fieldset key={g.title} aria-label={g.title} className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{g.title}</legend>
            {g.items.map((it) => {
              const locked = it.key === 'parent_monitor'
              return (
                <div key={it.key} className="flex items-start gap-3">
                  <input type="checkbox" role="switch" id={`sw-${it.key}`} aria-label={it.label} className="mt-1"
                    checked={locked ? false : value[it.key]} disabled={locked}
                    onChange={(e) => setDraft({ ...value, [it.key]: e.target.checked })} />
                  <div className="text-sm">
                    <label htmlFor={`sw-${it.key}`}>{it.label}</label>
                    {it.note && <p className="text-xs text-muted-foreground">{it.note}</p>}
                  </div>
                </div>
              )
            })}
          </fieldset>
        ))}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button type="button" disabled={busy} onClick={() => void save()}>保存开关</Button>
        </div>
      </CardContent>
    </Card>
  )
}
