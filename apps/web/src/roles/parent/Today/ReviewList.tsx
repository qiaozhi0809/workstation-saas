import { formatInTz } from '@/shared/lib/date'
import { cn } from '@/shared/lib/utils'
import type { ParentReview } from '@/shared/types/parent'
import { useSchoolTz } from '../useMeta'

/** 今日点评:时间按学校时区(/meta,L79),与点评历史同一口径 */
export default function ReviewList({
  reviews,
  weekPoints,
}: {
  reviews: ParentReview[] | null
  weekPoints: number | null
}) {
  const tz = useSchoolTz()
  const items = reviews ?? []
  return (
    <section aria-label="今日点评" className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm text-muted-foreground">今日点评</h2>
        <p className="text-sm text-muted-foreground">
          本周积分{' '}
          <span className="text-base font-semibold text-foreground">{weekPoints ?? 0}</span>
        </p>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">今天还没有点评</p>
      ) : (
        <ul className="mt-2 divide-y">
          {items.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2">
              <span
                className={cn(
                  'min-w-10 shrink-0 text-base font-semibold tabular-nums',
                  r.score_delta > 0 && 'text-success',
                  r.score_delta < 0 && 'text-destructive',
                  r.score_delta === 0 && 'text-muted-foreground',
                )}
              >
                {r.score_delta > 0 ? `+${r.score_delta}` : `${r.score_delta}`}
              </span>
              <div className="min-w-0 text-sm">
                <p className="break-words">{r.reason_text}</p>
                <p className="text-xs text-muted-foreground">
                  {[formatInTz(r.given_at, tz).slice(11), r.subject, r.given_by_name]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
