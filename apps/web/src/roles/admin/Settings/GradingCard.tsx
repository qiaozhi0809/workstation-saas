import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { GRADING_QUERY_KEY } from '@/shared/hooks/useGrading'
import type { Grading } from '@/shared/types/school'

/** 整数百分比的允许范围(与后端 pass_ratio 0.30–0.95、good_ratio 0.40–1.00 一致) */
const PASS = { min: 30, max: 95 }
const GOOD = { min: 40, max: 100 }

interface Draft {
  pass: string
  good: string
}

const toDraft = (g: Grading): Draft => ({
  pass: String(Math.round(g.pass_ratio * 100)),
  good: String(Math.round(g.good_ratio * 100)),
})

const inRange = (n: number, r: { min: number; max: number }) =>
  Number.isInteger(n) && n >= r.min && n <= r.max

/** 返回第一条校验问题;'' 表示合法 */
function validate(d: Draft): string {
  const pass = Number(d.pass)
  const good = Number(d.good)
  if (d.pass.trim() === '' || !inRange(pass, PASS))
    return `及格线要在 ${PASS.min}%–${PASS.max}% 之间的整数`
  if (d.good.trim() === '' || !inRange(good, GOOD))
    return `优秀线要在 ${GOOD.min}%–${GOOD.max}% 之间的整数`
  if (good <= pass) return '优秀线要高于及格线'
  return ''
}

export default function GradingCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: GRADING_QUERY_KEY, queryFn: schoolApi.grading })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (q.isPending) return <LoadingState />
  if (q.isError) {
    return (
      <ErrorState
        title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  }
  const value = draft ?? toDraft(q.data)
  const problem = validate(value)

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await schoolApi.saveGrading({
        pass_ratio: Number(value.pass) / 100,
        good_ratio: Number(value.good) / 100,
      })
      qc.setQueryData(GRADING_QUERY_KEY, next)
      void qc.invalidateQueries({ queryKey: GRADING_QUERY_KEY })
      setDraft(null)
      toast('已保存')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card role="group" aria-label="及格线与优秀线">
      <CardHeader>
        <CardTitle>及格线与优秀线</CardTitle>
        <CardDescription>
          按各科满分的比例计算,老师端分析、AI 统计、成绩汇总一起生效
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="grading-pass">及格线(%)</Label>
            <Input
              id="grading-pass"
              type="number"
              inputMode="numeric"
              min={PASS.min}
              max={PASS.max}
              step={1}
              className="w-28"
              value={value.pass}
              onChange={(e) => setDraft({ ...value, pass: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{`${PASS.min}–${PASS.max},满分 100 分时 60 就是 60 分及格`}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="grading-good">优秀线(%)</Label>
            <Input
              id="grading-good"
              type="number"
              inputMode="numeric"
              min={GOOD.min}
              max={GOOD.max}
              step={1}
              className="w-28"
              value={value.good}
              onChange={(e) => setDraft({ ...value, good: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{`${GOOD.min}–${GOOD.max},要高于及格线`}</p>
          </div>
        </div>
        {(problem || error) && (
          <p role="alert" className="text-sm text-destructive">
            {problem || error}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={busy || draft === null || problem !== ''}
            onClick={() => void save()}
          >
            保存及格线
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
