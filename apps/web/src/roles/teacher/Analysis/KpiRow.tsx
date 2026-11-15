import { Card } from '@/shared/components/ui/card'
import type { ExamStats } from '@/shared/lib/grades'
import { cn } from '@/shared/lib/utils'
import { round1 } from './round1'

function Delta({ diff, cmpName }: { diff: number | null; cmpName: string }) {
  if (diff === null) return <div className="text-xs text-muted-foreground">—</div>
  if (round1(Math.abs(diff)) === 0)
    return <div className="text-xs text-muted-foreground">与上次持平</div>
  const up = diff > 0
  return (
    <div className={cn('text-xs', up ? 'text-success' : 'text-destructive')}>
      {up ? '↑' : '↓'} {round1(Math.abs(diff))} 个百分点 较{cmpName}
    </div>
  )
}

function KpiCard({
  title,
  children,
  delta,
}: {
  title: string
  children: React.ReactNode
  delta: React.ReactNode
}) {
  return (
    <Card data-kpi className="flex flex-col gap-1 p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      {children}
      {delta}
    </Card>
  )
}

/** names:enrollment_id -> 姓名 */
export function KpiRow({
  cur,
  cmp,
  cmpName,
  names,
}: {
  cur: ExamStats
  cmp: ExamStats | null
  cmpName: string
  names: Map<string, string>
}) {
  const diff = (f: (s: ExamStats) => number) => (cmp ? f(cur) - f(cmp) : null)
  const winners = cur.maxIds.map((id) => names.get(id) ?? id).join('、')
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
      <KpiCard title="平均分" delta={<Delta diff={diff((s) => s.rate)} cmpName={cmpName} />}>
        <div className="text-2xl font-medium tabular-nums">
          {round1(cur.avg)}{' '}
          <span className="text-sm font-normal text-muted-foreground">/ {cur.full}</span>
        </div>
      </KpiCard>
      <KpiCard
        title="最高分"
        delta={<Delta diff={diff((s) => (s.max / s.full) * 100)} cmpName={cmpName} />}
      >
        <div className="text-2xl font-medium tabular-nums">{cur.max}</div>
        <div className="text-xs text-muted-foreground">{winners}</div>
      </KpiCard>
      <KpiCard
        title="及格率"
        delta={<Delta diff={diff((s) => s.passRate * 100)} cmpName={cmpName} />}
      >
        <div className="text-2xl font-medium tabular-nums">{round1(cur.passRate * 100)}%</div>
      </KpiCard>
      <KpiCard
        title="优秀率"
        delta={<Delta diff={diff((s) => s.goodRate * 100)} cmpName={cmpName} />}
      >
        <div className="text-2xl font-medium tabular-nums">{round1(cur.goodRate * 100)}%</div>
      </KpiCard>
      <KpiCard
        title="标准差"
        delta={<div className="text-xs text-muted-foreground">越小说明分数越集中</div>}
      >
        <div className="text-2xl font-medium tabular-nums">{round1(cur.sd)}</div>
      </KpiCard>
    </div>
  )
}
