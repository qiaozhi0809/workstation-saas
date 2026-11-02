import { useQuery } from '@tanstack/react-query'
import { reviewsApi } from '@/shared/api/reviews'
import { formatInTz } from '@/shared/lib/date'
import { Card } from '@/shared/components/ui/card'
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
    <Card className="p-3">
      <h3 className="text-sm font-semibold">最近点评</h3>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">还没有点评记录</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-xs">
          {items.map((r) => (
            <li key={r.id}>
              {/* 每条点评都对应一名学生(全班点评也按人记);已转出的学生不在名单里,用后端返回的姓名 */}
              {`${r.transferred ? `${r.student_name}（已转出）` : (names.get(r.enrollment_id) ?? r.student_name)} ${r.reason_text} ${signed(r.score_delta)} · ${r.given_by_me ? '我' : '老师'} · ${formatInTz(r.given_at, timezone).slice(11)}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
