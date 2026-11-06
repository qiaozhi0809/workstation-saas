import { ScoreBars, type BarDatum } from '@/shared/components/charts/ScoreBars'
import { scoreBands, type ExamStats } from '@/shared/lib/grades'
import type { Grading } from '@/shared/types/school'

const TONE: Record<'low' | 'mid' | 'good', BarDatum['tone']> = {
  low: 'low',
  mid: 'main',
  good: 'good',
}
const LEGEND = [
  { text: '不及格段', cls: 'bg-chart-4' },
  { text: '及格段', cls: 'bg-chart-1' },
  { text: '优秀段', cls: 'bg-chart-3' },
]

/** ratios:学校的及格 / 优秀比例(useGrading()),与算出 stats 的是同一份;分档颜色按它定 */
export function BandChart({
  stats,
  width,
  ratios,
}: {
  stats: ExamStats
  width?: number
  ratios: Grading
}) {
  const totals = stats.table.flatMap((r) => (r.total === null ? [] : [r.total]))
  const data: BarDatum[] = scoreBands(totals, stats.full, ratios).map((b) => ({
    label: `${b.lo}–${b.hi}`,
    value: b.count,
    tone: TONE[b.tone],
    tip: [`${b.count} 人`],
  }))
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">总分分数段</h2>
        <ul className="flex gap-3 text-xs text-muted-foreground">
          {LEGEND.map((l) => (
            <li key={l.text} className="flex items-center gap-1">
              <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${l.cls}`} />
              {l.text}
            </li>
          ))}
        </ul>
      </div>
      <ScoreBars label="总分分数段" width={width} data={data} valueLabels />
    </section>
  )
}
