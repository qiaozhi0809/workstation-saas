import { Card } from '@/shared/components/ui/card'
import type { TodayView } from '@/shared/types/admin'

function Kpi({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card data-kpi className="flex flex-col gap-1 p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-2xl font-medium tabular-nums">{children}</div>
    </Card>
  )
}

export function KpiRow({ totals }: { totals: TodayView['totals'] }) {
  const rate =
    totals.students > 0 ? `${((totals.present / totals.students) * 100).toFixed(1)}%` : '—'
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi title="在读">{totals.students}</Kpi>
      <Kpi title="出勤率">{rate}</Kpi>
      <Kpi title="请假">{totals.leave}</Kpi>
      <Kpi title="缺勤">{totals.absent}</Kpi>
      <Kpi title="迟到">{totals.late}</Kpi>
      <Kpi title="考勤确认">{`${totals.confirmed_classes} / ${totals.classes}`}</Kpi>
    </div>
  )
}
