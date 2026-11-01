import { useQuery } from '@tanstack/react-query'
import { reviewsApi } from '@/shared/api/reviews'
import { formatInTz } from '@/shared/lib/date'
import type { StudentSeat } from '@/shared/types/student'
import { signed } from '../review/signed'

export default function FeedSection({ classId, roster, timezone }: {
  classId: string
  roster: StudentSeat[]
  timezone: string
}) {
  // 键以 ['reviews', classId] 开头:点评模式提交 / 撤销后的失效会一并刷新这里
  const feed = useQuery({
    queryKey: ['reviews', classId, 'feed'],
    queryFn: () => reviewsApi.list(classId, { limit: 6 }),
  })
  const names = new Map(roster.map((s) => [s.enrollment_id, s.name]))
  const items = feed.data?.items ?? []
  return (
    <section className="rounded-2xl border border-line bg-panel p-3">
      <h3 className="text-sm font-semibold">最近点评</h3>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-ink-2">还没有点评记录</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-xs">
          {items.map((r) => (
            <li key={r.id}>
              {`${names.get(r.enrollment_id) ?? '全班'} ${r.reason_text} ${signed(r.score_delta)} · ${r.given_by_me ? '我' : '老师'} · ${formatInTz(r.given_at, timezone).slice(11)}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
