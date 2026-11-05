import { EmptyState } from '@/shared/components/feedback/EmptyState'
import type { TodayView } from '@/shared/types/admin'

export function UnconfirmedList({ items }: { items: TodayView['unconfirmed'] }) {
  if (items.length === 0) return <EmptyState title="各班都已确认" />
  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-card">
      {items.map((c) => (
        <li
          key={c.class_id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
        >
          <span className="font-medium">{c.class_name}</span>
          <span className="text-muted-foreground">
            {c.homeroom_name ? `班主任 ${c.homeroom_name}` : '暂无班主任'}
          </span>
        </li>
      ))}
    </ul>
  )
}
