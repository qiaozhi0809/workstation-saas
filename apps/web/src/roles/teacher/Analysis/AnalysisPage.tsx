import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { examStats, latestExam, previousExam } from '@/shared/lib/grades'
import ClassGate from '../ClassGate'
import { BandChart } from './BandChart'
import { KpiRow } from './KpiRow'
import { SubjectRateChart } from './SubjectRateChart'
import { TrendGrid } from './TrendGrid'

function AnalysisBody({ classId, chartWidth }: { classId: string; chartWidth?: number }) {
  const [params, setParams] = useSearchParams()
  const book = useQuery({ queryKey: ['gradebook', classId], queryFn: () => examsApi.gradebook(classId) })
  const roster = useQuery({ queryKey: ['class-students', classId], queryFn: () => studentsApi.listInClass(classId) })

  const ids = useMemo(() => (roster.data?.items ?? []).map((s) => s.enrollment_id), [roster.data])
  const names = useMemo(
    () => new Map((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.name])),
    [roster.data],
  )
  // 只保留名单内学生有分数的考试
  const scored = useMemo(
    () => (book.data?.exams ?? []).filter((e) => examStats(e, ids) !== null),
    [book.data, ids],
  )

  if (book.isLoading || roster.isLoading) return <LoadingState />
  if (book.isError || roster.isError) {
    return <ErrorState title="成绩加载失败" onRetry={() => { void book.refetch(); void roster.refetch() }} />
  }

  const current = scored.find((e) => e.id === params.get('exam')) ?? latestExam(scored)
  if (!current) {
    return (
      <EmptyState title="还没有考试成绩"
        action={<Link to="/teacher/scores" className="text-sm text-primary underline">去录入成绩</Link>} />
    )
  }
  const cmpParam = params.get('cmp')
  const cmpExam = cmpParam === 'none' ? null
    : scored.find((e) => e.id === cmpParam) ?? previousExam(scored, current.id)
  const cur = examStats(current, ids)
  if (!cur) return null
  const cmp = cmpExam ? examStats(cmpExam, ids) : null

  const update = (fn: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          考试
          <NativeSelect value={current.id}
            onChange={(e) => update((p) => { p.set('exam', e.target.value); p.delete('cmp') })}>
            {scored.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          对比
          <NativeSelect value={cmpExam?.id ?? 'none'} onChange={(e) => update((p) => p.set('cmp', e.target.value))}>
            <option value="none">不对比</option>
            {scored.filter((e) => e.id !== current.id || cmpExam?.id === e.id).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <KpiRow cur={cur} cmp={cmp} cmpName={cmpExam?.name ?? ''} names={names} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SubjectRateChart stats={cur} width={chartWidth} />
        <BandChart stats={cur} width={chartWidth} />
      </div>
      <TrendGrid book={scored} ids={ids} width={chartWidth} />
    </div>
  )
}

/** chartWidth 仅供测试:jsdom 量不出容器宽度,给定后图表按固定宽度渲染 */
export default function AnalysisPage({ chartWidth }: { chartWidth?: number } = {}) {
  return (
    <ClassGate title="成绩分析" need="exam.read">
      {(ctx) => <AnalysisBody classId={ctx.cls.id} chartWidth={chartWidth} />}
    </ClassGate>
  )
}
