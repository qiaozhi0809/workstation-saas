import { EmptyState } from '@/shared/components/feedback/EmptyState'
import type { TodayView } from '@/shared/types/admin'
import { cn } from '@/shared/lib/utils'
import { TONE_TEXT, ATTENDANCE_TONE } from '@/shared/lib/tone'

const LABEL = { leave: '请假', absent: '缺勤' } as const

export function AbsenteeList({ items, onOpen }: { items: TodayView['absentees']; onOpen(studentId: string): void }) {
  if (items.length === 0) return <EmptyState title="今天全员到齐" />
  const groups = new Map<string, { name: string; rows: TodayView['absentees'] }>()
  for (const it of items) {
    const g = groups.get(it.class_id) ?? { name: it.class_name, rows: [] }
    g.rows.push(it)
    groups.set(it.class_id, g)
  }
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([id, g]) => (
        <section key={id} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-muted-foreground">{g.name}</h3>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {g.rows.map((r) => (
              <li key={r.student_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <button type="button" onClick={() => onOpen(r.student_id)}
                  className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {r.name}
                </button>
                <span className={cn('font-medium', TONE_TEXT[ATTENDANCE_TONE[r.status]])}>{LABEL[r.status]}</span>
                {r.reason && <span className="text-muted-foreground">{r.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
