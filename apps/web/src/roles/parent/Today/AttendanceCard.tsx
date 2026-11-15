import { Card } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import type { ParentToday } from '@/shared/types/parent'

type Att = NonNullable<ParentToday['attendance']>

const TONE: Record<Att['status'], string> = {
  present: 'text-success',
  leave: 'text-warning',
  absent: 'text-destructive',
  late: 'text-warning',
}

function describe(a: ParentToday['attendance']): { text: string; tone: string } {
  if (!a) return { text: '老师还没点名', tone: 'text-muted-foreground' }
  const tone = TONE[a.status]
  switch (a.status) {
    case 'present':
      return { text: '出勤', tone }
    case 'leave':
      return { text: a.reason ? `请假:${a.reason}` : '请假', tone }
    case 'absent':
      return { text: '缺勤', tone }
    case 'late':
      return { text: '迟到', tone }
  }
}

export default function AttendanceCard({ attendance }: { attendance: ParentToday['attendance'] }) {
  const { text, tone } = describe(attendance)
  return (
    <Card role="region" aria-label="今日出勤" className="p-4">
      <h2 className="text-sm text-muted-foreground">今日出勤</h2>
      <p className={cn('mt-1 text-base font-medium', tone)}>{text}</p>
    </Card>
  )
}
