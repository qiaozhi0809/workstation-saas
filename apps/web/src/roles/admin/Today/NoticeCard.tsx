import { Link } from 'react-router-dom'
import type { TodayView } from '@/shared/types/admin'

/** 我最近发出的几条通知与已读率;没有时不渲染 */
export function NoticeCard({ notices }: { notices: TodayView['my_notices'] }) {
  if (!notices || notices.length === 0) return null
  return (
    <section aria-label="我发出的通知" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">我发出的通知</h2>
      <ul className="flex flex-col divide-y">
        {notices.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
            <span className="min-w-0 break-words font-medium">{n.title}</span>
            <span className="text-muted-foreground">
              {n.recipients > 0
                ? `已读 ${n.read} / ${n.recipients}(${Math.round((n.read / n.recipients) * 100)}%)`
                : `已读 ${n.read} / ${n.recipients}`}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/admin/notices" className="text-sm font-medium text-primary underline-offset-4 hover:underline">去发通知</Link>
    </section>
  )
}
