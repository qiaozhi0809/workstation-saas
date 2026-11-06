import type { SubjectStats } from '@/shared/lib/grades'
import { cn } from '@/shared/lib/utils'
import type { Grading } from '@/shared/types/school'
import { round1 } from './round1'

function RateChange({ cur, prev }: { cur: SubjectStats; prev: SubjectStats | undefined }) {
  if (!prev) return <span className="text-muted-foreground">—</span>
  const diff = round1(cur.rate - prev.rate)
  if (diff === 0) return <span className="text-muted-foreground">±0 个百分点</span>
  return (
    <span className={cn(diff > 0 ? 'text-success' : 'text-destructive')}>
      {diff > 0 ? '+' : '-'}
      {Math.abs(diff)} 个百分点
    </span>
  )
}

/** prev 为 null 表示没有对比,不显示得分率变化列;ratios 只用来写脚注,与算出 stats 的比例保持同一份 */
export function SubjectTable({
  stats,
  prev,
  ratios,
}: {
  stats: SubjectStats[]
  prev: SubjectStats[] | null
  ratios: Grading
}) {
  const heads = [
    '科目',
    '满分',
    '平均分',
    '得分率',
    '最高',
    '最低',
    '及格率',
    '优秀率',
    '不及格人数',
    ...(prev ? ['得分率变化'] : []),
  ]
  return (
    <section aria-label="各科明细" className="rounded-lg border bg-card text-card-foreground">
      <h2 className="px-3 pt-3 text-base font-semibold">各科明细</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              {heads.map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.name} className="border-t">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2">{s.full}</td>
                <td className="px-3 py-2">{round1(s.avg)}</td>
                <td className="px-3 py-2">{round1(s.rate)}%</td>
                <td className="px-3 py-2">{s.max}</td>
                <td className="px-3 py-2">{s.min}</td>
                <td className="px-3 py-2">{round1(s.passRate * 100)}%</td>
                <td className="px-3 py-2">{round1(s.goodRate * 100)}%</td>
                <td className="px-3 py-2">{s.low}</td>
                {prev && (
                  <td className="px-3 py-2">
                    <RateChange cur={s} prev={prev.find((p) => p.name === s.name)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 pb-3 text-xs text-muted-foreground">
        及格 = 满分 {Math.round(ratios.pass_ratio * 100)}%,优秀 = 满分{' '}
        {Math.round(ratios.good_ratio * 100)}%
      </p>
    </section>
  )
}
