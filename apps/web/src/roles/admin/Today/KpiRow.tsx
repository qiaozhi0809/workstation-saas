import type { TodayView } from '@/shared/types/admin'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-kpi className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-2xl font-semibold">{children}</div>
    </div>
  )
}

export function KpiRow({ totals }: { totals: TodayView['totals'] }) {
  const rate = totals.students > 0 ? `${((totals.present / totals.students) * 100).toFixed(1)}%` : '—'
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card title="在读">{totals.students}</Card>
      <Card title="出勤率">{rate}</Card>
      <Card title="请假">{totals.leave}</Card>
      <Card title="缺勤">{totals.absent}</Card>
      <Card title="迟到">{totals.late}</Card>
      <Card title="考勤确认">{`${totals.confirmed_classes} / ${totals.classes}`}</Card>
    </div>
  )
}
