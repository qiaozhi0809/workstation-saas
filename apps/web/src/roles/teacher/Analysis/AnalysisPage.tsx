import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { NativeSelect } from '@/shared/components/ui/native-select'
import {
  attention, examStats, examTable, latestExam, previousExam, rankChanges, subjectStats,
} from '@/shared/lib/grades'
import { useStudentDrawer } from '../StudentProfile/useStudentDrawer'
import ClassGate from '../ClassGate'
import { AttentionPanel } from './AttentionPanel'
import { BandChart } from './BandChart'
import { KpiRow } from './KpiRow'
import { RankTable } from './RankTable'
import { SubjectRateChart } from './SubjectRateChart'
import { SubjectTable } from './SubjectTable'
import { TrendGrid } from './TrendGrid'

function AnalysisBody({ classId, chartWidth }: { classId: string; chartWidth?: number }) {
  const [params, setParams] = useSearchParams()
  const book = useQuery({ queryKey: ['gradebook', classId], queryFn: () => examsApi.gradebook(classId) })
  const roster = useQuery({ queryKey: ['class-students', classId], queryFn: () => studentsApi.listInClass(classId) })

  const examParam = params.get('exam')
  const cmpParam = params.get('cmp')
  const drawer = useStudentDrawer()
  const ids = useMemo(() => (roster.data?.items ?? []).map((s) => s.enrollment_id), [roster.data])
  const names = useMemo(
    () => new Map((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.name])),
    [roster.data],
  )
  const studentIds = useMemo(
    () => new Map((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.student_id])),
    [roster.data],
  )
  // 只保留名单内学生有分数的考试
  const scored = useMemo(
    () => (book.data?.exams ?? []).filter((e) => examStats(e, ids) !== null),
    [book.data, ids],
  )

  // 当前考试、对比考试及其派生数据只在输入变化时算一次
  const view = useMemo(() => {
    const current = scored.find((e) => e.id === examParam) ?? latestExam(scored)
    if (!current) return null
    const cmpExam = cmpParam === 'none' ? null
      : scored.find((e) => e.id === cmpParam) ?? previousExam(scored, current.id)
    const cur = examStats(current, ids)
    if (!cur) return null
    const cmp = cmpExam ? examStats(cmpExam, ids) : null
    const rows = examTable(current, ids)
    const prevRows = cmpExam ? examTable(cmpExam, ids) : null
    const changes = prevRows ? rankChanges(rows, prevRows) : null
    const subjectNow = current.subjects.flatMap((s) => subjectStats(current, s.name, ids) ?? [])
    const subjectPrev = cmpExam ? cmpExam.subjects.flatMap((s) => subjectStats(cmpExam, s.name, ids) ?? []) : null
    return {
      current, cmpExam, cur, cmp, rows, changes, subjectNow, subjectPrev,
      attn: attention(current, rows, changes ?? new Map()),
    }
  }, [scored, ids, examParam, cmpParam])

  if (book.isLoading || roster.isLoading) return <LoadingState />
  if (!book.data || !roster.data) {
    return <ErrorState title="成绩加载失败" retrying={book.isFetching || roster.isFetching} onRetry={() => { void book.refetch(); void roster.refetch() }} />
  }
  if (!view) {
    return (
      <EmptyState title="还没有考试成绩"
        action={<Link to="/teacher/scores" className="text-sm text-primary underline">去录入成绩</Link>} />
    )
  }
  const { current, cmpExam, cur, cmp, rows, changes, subjectNow, subjectPrev, attn } = view

  const update = (fn: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }

  const openStudent = (enrollmentId: string) => {
    const studentId = studentIds.get(enrollmentId)
    if (studentId) drawer.open(studentId, '成绩')
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
      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <RankTable subjects={current.subjects} rows={rows} changes={changes} names={names} onOpen={openStudent} />
        <AttentionPanel attention={attn} names={names} showFailing={current.subjects.length >= 2}
          onOpen={openStudent} />
      </div>
      <SubjectTable stats={subjectNow} prev={subjectPrev} />
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
