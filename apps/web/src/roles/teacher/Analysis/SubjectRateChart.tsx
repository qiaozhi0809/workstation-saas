import { ScoreBars, type BarDatum } from '@/shared/components/charts/ScoreBars'
import type { ExamStats } from '@/shared/lib/grades'
import type { Grading } from '@/shared/types/school'
import { round1 } from './round1'

/** ratios:学校的及格 / 优秀比例(useGrading()),与算出 stats 的是同一份;及格参考线与低分着色按它定 */
export function SubjectRateChart({
  stats,
  width,
  ratios,
}: {
  stats: ExamStats
  width?: number
  ratios: Grading
}) {
  // 得分率是百分数,及格线同样换成百分数(比例两位小数 → 整数百分比)
  const passPct = Math.round(ratios.pass_ratio * 100)
  const data: BarDatum[] = stats.subjects.map((s) => ({
    label: s.name,
    value: round1(s.rate),
    tone: s.rate < passPct ? 'low' : 'main',
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
        refLine={{ value: passPct, label: '及格' }}
      />
    </section>
  )
}
