import { TrendLine } from '@/shared/components/charts/TrendLine'
import { examStats, subjectStats, trendDomain } from '@/shared/lib/grades'
import type { GradebookExam } from '@/shared/types/grades'
import { round1 } from './round1'

/** book:按时间排好的成绩册;ids:enrollment_id。至少两场有分数的考试才渲染。 */
export function TrendGrid({
  book,
  ids,
  width,
}: {
  book: GradebookExam[]
  ids: string[]
  width?: number
}) {
  const scored = book.flatMap((exam) => {
    const stats = examStats(exam, ids)
    return stats ? [{ exam, stats }] : []
  })
  if (scored.length < 2) return null

  const names: string[] = []
  for (const { exam } of scored)
    for (const s of exam.subjects) if (!names.includes(s.name)) names.push(s.name)
  const labels = scored.map(({ exam }) => exam.name)
  const rows = [
    {
      key: 'total',
      label: '总分',
      values: scored.map(({ stats }) => round1(stats.rate)) as (number | null)[],
    },
    ...names.map((name) => ({
      key: name,
      label: name,
      values: scored.map(({ exam }) => {
        const st = subjectStats(exam, name, ids)
        return st ? round1(st.rate) : null
      }) as (number | null)[],
    })),
  ]
  const [lo, hi] = trendDomain(rows.flatMap((r) => r.values.filter((v): v is number => v !== null)))
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">得分率趋势</h2>
        <span className="text-xs text-muted-foreground">
          纵轴 {lo}–{hi}%
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="mb-1 text-xs text-muted-foreground">{r.label}</div>
            <TrendLine
              label={`${r.label}得分率趋势`}
              width={width}
              height={120}
              labels={labels}
              series={[{ key: r.key, label: r.label, values: r.values }]}
              domain={[lo, hi]}
              endLabel
              format={(v) => `${round1(v)}%`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
