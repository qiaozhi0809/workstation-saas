import { Card } from '@/shared/components/ui/card'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
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
    <Card>
      <section aria-label="各科明细">
        <h2 className="px-3 pt-4 text-base font-medium">各科明细</h2>
        <Table className="mt-2" containerClassName="rounded-none bg-transparent shadow-none">
          <TableHead>
            <TableRow>
              {heads.map((h, i) => (
                <Th key={h} numeric={i > 0}>
                  {h}
                </Th>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.name}>
                <Td className="font-medium">{s.name}</Td>
                <Td numeric>{s.full}</Td>
                <Td numeric>{round1(s.avg)}</Td>
                <Td numeric>{round1(s.rate)}%</Td>
                <Td numeric>{s.max}</Td>
                <Td numeric>{s.min}</Td>
                <Td numeric>{round1(s.passRate * 100)}%</Td>
                <Td numeric>{round1(s.goodRate * 100)}%</Td>
                <Td numeric>{s.low}</Td>
                {prev && (
                  <Td numeric>
                    <RateChange cur={s} prev={prev.find((p) => p.name === s.name)} />
                  </Td>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="px-3 pb-4 pt-2 text-xs text-muted-foreground">
          及格 = 满分 {Math.round(ratios.pass_ratio * 100)}%,优秀 = 满分{' '}
          {Math.round(ratios.good_ratio * 100)}%
        </p>
      </section>
    </Card>
  )
}
