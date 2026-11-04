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

/** 日期倒序;按 year_name 分组(首次出现顺序),每学年一段 */
export default function GrowthTimeline({ records }: { records: ParentGrowthRecord[] }) {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const groups: { year: string; items: ParentGrowthRecord[] }[] = []
  for (const r of sorted) {
    const g = groups.find((x) => x.year === r.year_name)
    if (g) g.items.push(r)
    else groups.push({ year: r.year_name, items: [r] })
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.year} aria-label={g.year} className="space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>{g.year}</span>
            <span className="h-px flex-1 bg-border" />
          </h3>
          <ul className="space-y-2">
            {g.items.map((r) => (
              <li key={r.id} className="rounded-xl border bg-card p-3 text-sm text-card-foreground">
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', TAG[r.type] ?? TAG.其他)}>{r.type}</span>
                  <time className="text-xs text-muted-foreground" dateTime={r.date}>{r.date}</time>
                </div>
                <p className="mt-1 break-words whitespace-pre-wrap">{r.content}</p>
                {r.created_by_name && <p className="mt-1 text-xs text-muted-foreground">{r.created_by_name}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
