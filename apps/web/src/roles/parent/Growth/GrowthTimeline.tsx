import { Fragment } from 'react'
import { cn } from '@/shared/lib/utils'
import type { GrowthType } from '@/shared/types/growth'
import type { ParentGrowthRecord } from '@/shared/types/parent'

const TAG: Record<GrowthType, string> = {
  表扬: 'bg-success/15 text-success',
  谈话: 'bg-info/15 text-info',
  家访: 'bg-primary/15 text-primary',
  获奖: 'bg-warning/15 text-warning',
  提醒: 'bg-destructive/15 text-destructive',
  其他: 'bg-muted text-muted-foreground',
}

/** 日期倒序;year_name 变化处插学年分隔 */
export default function GrowthTimeline({ records }: { records: ParentGrowthRecord[] }) {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return (
    <ul className="space-y-2">
      {sorted.map((r, i) => (
        <Fragment key={r.id}>
          {(i === 0 || sorted[i - 1].year_name !== r.year_name) && (
            <li role="separator" aria-label={r.year_name} className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>{r.year_name}</span>
              <span className="h-px flex-1 bg-border" />
            </li>
          )}
          <li className="rounded-xl border bg-card p-3 text-sm text-card-foreground">
            <div className="flex items-center gap-2">
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', TAG[r.type])}>{r.type}</span>
              <time className="text-xs text-muted-foreground" dateTime={r.date}>{r.date}</time>
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap">{r.content}</p>
            {r.created_by_name && <p className="mt-1 text-xs text-muted-foreground">{r.created_by_name}</p>}
          </li>
        </Fragment>
      ))}
    </ul>
  )
}
