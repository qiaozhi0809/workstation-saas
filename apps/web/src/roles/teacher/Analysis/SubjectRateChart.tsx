import { ScoreBars, type BarDatum } from '@/shared/components/charts/ScoreBars'
import type { ExamStats } from '@/shared/lib/grades'
import { round1 } from './round1'

export function SubjectRateChart({ stats, width }: { stats: ExamStats; width?: number }) {
  const data: BarDatum[] = stats.subjects.map((s) => ({
    label: s.name,
    value: round1(s.rate),
    tone: s.rate < 60 ? 'low' : 'main',
    tip: [
      `满分 ${s.full}`,
      `平均 ${round1(s.avg)}`,
      `最高 ${s.max}`,
      `最低 ${s.min}`,
      `及格率 ${round1(s.passRate * 100)}%`,
      `优秀率 ${round1(s.goodRate * 100)}%`,
    ],
  }))
  return (
    <section className="rounded-lg border bg-card p-3">
      <h2 className="mb-2 text-sm font-medium">各科平均得分率</h2>
      <ScoreBars
        label="各科平均得分率"
        width={width}
        data={data}
        max={100}
        format={(v) => `${v}%`}
        refLine={{ value: 60, label: '及格' }}
      />
    </section>
  )
}
