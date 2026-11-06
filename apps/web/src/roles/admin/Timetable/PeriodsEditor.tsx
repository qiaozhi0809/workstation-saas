import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { timetableApi } from '@/shared/api/timetable'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { Period } from '@/shared/types/timetable'

const MAX_PERIODS = 12
const NOS = Array.from({ length: MAX_PERIODS }, (_, i) => i + 1)

const byNo = (periods: Period[]) => [...periods].sort((a, b) => a.no - b.no)

/** "HH:MM" 加分钟;越过当天结束返回 null */
function addMinutes(hhmm: string, minutes: number): string | null {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  if (total >= 24 * 60) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** 与后端 PeriodsInput 同一套规则:时间齐全、开始早于结束、编号不重复、按编号排序后相邻不重叠 */
function validatePeriods(periods: Period[]): string | null {
  for (const p of periods) {
    if (!p.starts_at || !p.ends_at) return `请填写第 ${p.no} 节的时间`
    if (p.starts_at >= p.ends_at) return `第 ${p.no} 节开始时间必须早于结束时间`
  }
  const ordered = byNo(periods)
  if (new Set(ordered.map((p) => p.no)).size !== ordered.length) return '节次编号重复'
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const cur = ordered[i]
    if (cur.starts_at < prev.ends_at) return `第 ${prev.no} 节与第 ${cur.no} 节时间重叠`
  }
  return null
}

/** 作息时间:整体替换式编辑,保存前前端先按后端同样的规则查一遍 */
export default function PeriodsEditor({ periods }: { periods: Period[] }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Period[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const value = draft ?? periods

  const update = (index: number, patch: Partial<Period>) => {
    setError('')
    setDraft(value.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }
  const add = () => {
    if (value.length >= MAX_PERIODS) return
    const used = new Set(value.map((p) => p.no))
    const no = NOS.find((n) => !used.has(n)) ?? MAX_PERIODS
    const ordered = byNo(value)
    const last = ordered[ordered.length - 1]
    const starts = last?.ends_at ? addMinutes(last.ends_at, 10) : '08:00'
    const ends = starts ? addMinutes(starts, 40) : null
    setError('')
    setDraft([...value, { no, starts_at: starts ?? '', ends_at: ends ?? '' }])
  }
  const remove = (index: number) => {
    setError('')
    setDraft(value.filter((_, i) => i !== index))
  }

  const save = async () => {
    const problem = validatePeriods(value)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const saved = await timetableApi.savePeriods(byNo(value))
      qc.setQueryData(['periods'], saved)
      setDraft(null)
      toast('已保存作息时间')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="periods-editor">
      <CardHeader>
        <CardTitle>作息时间</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {value.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有设置节次,先添加第 1 节。</p>
        )}
        <ul className="space-y-2">
          {value.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                第
                <NativeSelect
                  aria-label={`第 ${p.no} 节的编号`}
                  className="h-8 w-16"
                  value={p.no}
                  onChange={(e) => update(i, { no: Number(e.target.value) })}
                >
                  {NOS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
                节
              </label>
              <Input
                type="time"
                step={60}
                aria-label={`第 ${p.no} 节开始时间`}
                className="h-8 w-28"
                value={p.starts_at}
                onChange={(e) => update(i, { starts_at: e.target.value })}
              />
              <span aria-hidden="true">–</span>
              <Input
                type="time"
                step={60}
                aria-label={`第 ${p.no} 节结束时间`}
                className="h-8 w-28"
                value={p.ends_at}
                onChange={(e) => update(i, { ends_at: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`删除第 ${p.no} 节`}
                onClick={() => remove(i)}
              >
                删除
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={value.length >= MAX_PERIODS}
            onClick={add}
          >
            添加节次
          </Button>
          <span className="mr-auto text-xs text-muted-foreground">
            最多 {MAX_PERIODS} 节;被课表用到的节次不能删除
          </span>
          <Button type="button" disabled={busy || draft === null} onClick={() => void save()}>
            保存作息
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
