import { Card } from '@/shared/components/ui/card'
import { TrendLine } from '@/shared/components/charts/TrendLine'
import { examStats, subjectStats, trendDomain } from '@/shared/lib/grades'
import type { GradebookExam } from '@/shared/types/grades'
import type { Grading } from '@/shared/types/school'
import { round1 } from './round1'

const MIN_POINTS = 2

/** book:按时间排好的成绩册;ids:enrollment_id;ratios:学校及格比例(useGrading())。一个系列有两个以上有效点才画折线,否则(TrendLine 的 minPoints)给一行摘要,不画孤点。 */
export function TrendGrid({
  book,
  ids,
  width,
  ratios,
}: {
  book: GradebookExam[]
  ids: string[]
  width?: number
  ratios: Grading
}) {
  const scored = book.flatMap((exam) => {
    const stats = examStats(exam, ids, ratios)
    return stats ? [{ exam, stats }] : []
  })
  if (scored.length === 0) return null

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
        const st = subjectStats(exam, name, ids, ratios)
        return st ? round1(st.rate) : null
      }) as (number | null)[],
    })),
  ]
  // 至少有一条线真的画出来了,才有纵轴可说
  const drawn = rows.some((r) => r.values.filter((v) => v !== null).length >= MIN_POINTS)
  const [lo, hi] = trendDomain(rows.flatMap((r) => r.values.filter((v): v is number => v !== null)))
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-medium">得分率趋势</h2>
        {drawn && (
          <span className="text-xs text-muted-foreground">
            纵轴 {lo}–{hi}%
          </span>
        )}
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
              minPoints={MIN_POINTS}
              summary={(points) =>
                points.length === 1 ? `只有 1 次考试:得分率 ${round1(points[0].value)}%` : undefined
              }
              format={(v) => `${round1(v)}%`}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}
