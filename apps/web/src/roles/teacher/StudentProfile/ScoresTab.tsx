import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import { TrendLine } from '@/shared/components/charts/TrendLine'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { cellState, examTable, studentTrend } from '@/shared/lib/grades'
import type { StudentProfile } from '@/shared/types/student'

export default function ScoresTab({ profile }: { profile: StudentProfile }) {
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['gradebook', profile.class_id],
    queryFn: () => examsApi.gradebook(profile.class_id),
  })

  if (error instanceof ApiError && error.status === 403) return <EmptyState icon={Trophy} title="没有成绩权限" />
  if (error) return <ErrorState title="成绩加载失败" onRetry={() => void refetch()} retrying={isFetching} />
  if (!data) return <LoadingState />

  const me = profile.enrollment_id
  // 成绩册只含在读学生;无成绩的学生不影响排名
  const ids = [...new Set(data.exams.flatMap((e) => Object.keys(e.scores)))]
  const exams = data.exams.filter((e) => e.scores[me])
  if (exams.length === 0) return <EmptyState icon={Trophy} title="还没有考试成绩" />

  const subjectNames = [...new Set(exams.flatMap((e) => e.subjects.map((s) => s.name)))]
  const rows = exams.map((exam) => ({ exam, row: examTable(exam, ids).find((r) => r.id === me) })).reverse()
  const trend = studentTrend(data.exams, me, ids).filter((p) => data.exams.find((e) => e.id === p.examId)?.scores[me])

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">考试</th>
              {subjectNames.map((n) => <th key={n} className="px-2 py-1 font-normal">{n}</th>)}
              <th className="px-2 py-1 font-normal">总分</th>
              <th className="py-1 pl-2 font-normal">排名</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ exam, row }) => (
              <tr key={exam.id} className="border-t">
                <td className="py-1 pr-2">
                  <div>{exam.name}</div>
                  <div className="text-xs text-muted-foreground">{exam.date}</div>
                </td>
                {subjectNames.map((n) => {
                  const full = exam.subjects.find((s) => s.name === n)?.full ?? 0
                  const v = row?.subs[n]
                  const state = cellState(v, full)
                  return (
                    <td key={n} className="px-2 py-1">
                      {state === 'absent' ? <Badge variant="warning">缺考</Badge>
                        : state === 'empty' ? <span className="text-muted-foreground">—</span>
                        : <span className={state === 'ok' ? undefined : 'text-destructive'}>{v}</span>}
                    </td>
                  )
                })}
                <td className="px-2 py-1 font-semibold">{row?.total ?? '—'}</td>
                <td className="py-1 pl-2">{row?.rank ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">红色为不及格(低于满分的 60%)</p>
      </div>
      <section>
        <h3 className="mb-1 text-sm font-medium">排名变化</h3>
        <TrendLine label="排名变化" reversed labels={trend.map((p) => p.name)}
          series={[{ key: 'rank', label: '排名', values: trend.map((p) => p.rank) }]}
          format={(v) => `第 ${v} 名`} yAxisWidth={64} />
      </section>
    </div>
  )
}
