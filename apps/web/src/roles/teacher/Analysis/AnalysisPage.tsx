import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { useGrading } from '@/shared/hooks/useGrading'
import { aiLink } from '@/shared/lib/aiLink'
import type { ClassPerm } from '@/shared/types/classroom'
import {
  RANK_CHANGE_BASIS,
  attention,
  examStats,
  examTable,
  latestExam,
  previousExam,
  rankChanges,
  subjectStats,
} from '@/shared/lib/grades'
import { useStudentDrawer } from '../StudentProfile/useStudentDrawer'
import ClassGate from '../ClassGate'
import GradingFallback from '../GradingFallback'
import { AttentionPanel } from './AttentionPanel'
import { BandChart } from './BandChart'
import { KpiRow } from './KpiRow'
import { RankTable } from './RankTable'
import { SubjectRateChart } from './SubjectRateChart'
import { SubjectTable } from './SubjectTable'
import { TrendGrid } from './TrendGrid'

function AnalysisBody({
  classId,
  perms,
  chartWidth,
}: {
  classId: string
  perms: ClassPerm[]
  chartWidth?: number
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const book = useQuery({
    queryKey: ['gradebook', classId],
    queryFn: () => examsApi.gradebook(classId),
  })
  const roster = useQuery({
    queryKey: ['class-students', classId],
    queryFn: () => studentsApi.listInClass(classId),
  })

  const examParam = params.get('exam')
  const cmpParam = params.get('cmp')
  const drawer = useStudentDrawer()
  const grading = useGrading()
  const ids = useMemo(() => (roster.data?.items ?? []).map((s) => s.enrollment_id), [roster.data])
  const names = useMemo(
    () => new Map((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.name])),
    [roster.data],
  )
  const studentIds = useMemo(
    () => new Map((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.student_id])),
    [roster.data],
  )
  // 只保留名单内学生有分数的考试(成绩册按旧→新)
  const scored = useMemo(
    () => (book.data?.exams ?? []).filter((e) => examStats(e, ids, grading) !== null),
    [book.data, ids, grading],
  )
  // 下拉按新→旧,与成绩页的考试列表同序
  const options = useMemo(() => [...scored].reverse(), [scored])
  // 地址里指到的考试:在成绩册里但还没有分数(如从成绩页"看分析"跳来)→ 回退到最近一场时要说明;
  // 成绩册里根本没有(已删除 / 旧书签)→ 同样回退并说明(L254),不静默
  const picked = examParam ? book.data?.exams.find((e) => e.id === examParam) : undefined
  const unscoredPick = picked && !scored.some((e) => e.id === examParam) ? picked : undefined
  const missingPick = !!examParam && !!book.data && !picked

  // 当前考试、对比考试及其派生数据只在输入变化时算一次
  const view = useMemo(() => {
    const current = scored.find((e) => e.id === examParam) ?? latestExam(scored)
    if (!current) return null
    const cmpExam =
      cmpParam === 'none'
        ? null
        : (scored.find((e) => e.id === cmpParam) ?? previousExam(scored, current.id))
    const cur = examStats(current, ids, grading)
    if (!cur) return null
    const cmp = cmpExam ? examStats(cmpExam, ids, grading) : null
    const rows = examTable(current, ids)
    const prevRows = cmpExam ? examTable(cmpExam, ids) : null
    const changes = prevRows ? rankChanges(rows, prevRows) : null
    const subjectNow = current.subjects.flatMap(
      (s) => subjectStats(current, s.name, ids, grading) ?? [],
    )
    const subjectPrev = cmpExam
      ? cmpExam.subjects.flatMap((s) => subjectStats(cmpExam, s.name, ids, grading) ?? [])
      : null
    return {
      current,
      cmpExam,
      cur,
      cmp,
      rows,
      changes,
      subjectNow,
      subjectPrev,
      attn: attention(current, rows, changes ?? new Map(), grading),
    }
  }, [scored, ids, examParam, cmpParam, grading])

  if (book.isLoading || roster.isLoading) return <LoadingState />
  if (!book.data || !roster.data) {
    return (
      <ErrorState
        title="成绩加载失败"
        retrying={book.isFetching || roster.isFetching}
        onRetry={() => {
          void book.refetch()
          void roster.refetch()
        }}
      />
    )
  }
  if (!view) {
    return (
      <EmptyState
        title="还没有考试成绩"
        action={
          <Link to="/teacher/scores" className="text-sm text-primary underline">
            去录入成绩
          </Link>
        }
      />
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
      <GradingFallback grading={grading} />
      {unscoredPick && (
        <p role="status" className="text-sm text-muted-foreground">
          「{unscoredPick.name}」这场考试还没有分数,先显示最近一场有分数的考试
        </p>
      )}
      {missingPick && (
        <p role="status" className="text-sm text-muted-foreground">
          这场考试已不存在,已切到最近一场
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          考试
          <NativeSelect
            value={current.id}
            onChange={(e) =>
              update((p) => {
                p.set('exam', e.target.value)
                p.delete('cmp')
              })
            }
          >
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          对比
          <NativeSelect
            value={cmpExam?.id ?? 'none'}
            onChange={(e) => update((p) => p.set('cmp', e.target.value))}
          >
            <option value="none">不对比</option>
            {options
              .filter((e) => e.id !== current.id || cmpExam?.id === e.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </NativeSelect>
        </label>
        {/* 没手动选对比时说明默认口径;文案与 previousExam 的计算同出一处(放在 label 外,不混进它的名字) */}
        {cmpParam === null && cmpExam && (
          <span className="self-center text-xs text-muted-foreground">默认{RANK_CHANGE_BASIS}</span>
        )}
        {/* AI 快捷入口:跟随选择器换行;不对比时链接不带对比考试 */}
        <div className="ml-auto flex flex-wrap gap-2">
          {perms.includes('ai.use') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(aiLink({ tpl: 'report', examId: current.id, compareExamId: cmpExam?.id }))
              }
            >
              AI 写分析报告
            </Button>
          )}
          {perms.includes('ai.class') && cmpExam && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(
                  aiLink({ tpl: 'parent-batch', examId: current.id, compareExamId: cmpExam.id }),
                )
              }
            >
              给退步同学家长写沟通消息
            </Button>
          )}
        </div>
      </div>
      <KpiRow cur={cur} cmp={cmp} cmpName={cmpExam?.name ?? ''} names={names} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SubjectRateChart stats={cur} width={chartWidth} ratios={grading} />
        <BandChart stats={cur} width={chartWidth} ratios={grading} />
      </div>
      <TrendGrid book={scored} ids={ids} width={chartWidth} ratios={grading} />
      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <RankTable
          subjects={current.subjects}
          rows={rows}
          changes={changes}
          names={names}
          ratios={grading}
          onOpen={openStudent}
        />
        <AttentionPanel
          attention={attn}
          names={names}
          showFailing={current.subjects.length >= 2}
          onOpen={openStudent}
        />
      </div>
      <SubjectTable stats={subjectNow} prev={subjectPrev} ratios={grading} />
    </div>
  )
}

/** chartWidth 仅供测试:jsdom 量不出容器宽度,给定后图表按固定宽度渲染 */
export default function AnalysisPage({ chartWidth }: { chartWidth?: number } = {}) {
  return (
    <ClassGate title="成绩分析" need="exam.read">
      {(ctx) => <AnalysisBody classId={ctx.cls.id} perms={ctx.perms} chartWidth={chartWidth} />}
    </ClassGate>
  )
}
