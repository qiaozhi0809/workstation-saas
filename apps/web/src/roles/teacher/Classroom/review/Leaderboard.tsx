import { useMemo } from 'react'
import { groupOf } from '@/shared/components/ClassroomMap/layout'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'

/** 积分榜:小组积分(按座位列分组,未排座不计)+ 学生榜(同分并列,下一名跳号)。 */
export default function Leaderboard({ roster, summary, onClose }: {
  roster: StudentSeat[]
  summary: ReviewSummary | undefined
  onClose(): void
}) {
  useEscapeLayer(true, onClose)
  const { groups, rows } = useMemo(() => {
    const totals = new Map((summary?.items ?? []).map((t) => [t.enrollment_id, t]))
    const people = roster.map((s) => {
      const t = totals.get(s.enrollment_id)
      return { seat: s, total: t?.total ?? 0, plus: t?.plus_count ?? 0, minus: t?.minus_count ?? 0 }
    }).sort((a, b) => b.total - a.total)
    const byGroup = new Map<number, number>()
    for (const p of people) {
      if (p.seat.seat_col == null) continue
      const g = groupOf(p.seat.seat_col)
      byGroup.set(g, (byGroup.get(g) ?? 0) + p.total)
    }
    return {
      groups: [...byGroup].map(([g, total]) => ({ g, total })).sort((a, b) => b.total - a.total || a.g - b.g),
      rows: people.map((p, i) => ({ ...p, rank: i > 0 && people[i - 1].total === p.total ? 0 : i + 1 })),
    }
  }, [roster, summary])
  // 并列取上一名的名次
  let last = 0
  const ranked = rows.map((r) => { last = r.rank || last; return { ...r, rank: last } })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-label="积分榜" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[480px] max-w-[92vw] flex-col gap-3 overflow-hidden rounded-2xl bg-panel p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">积分榜</h3>
          <button type="button" aria-label="关闭" className="text-ink-2" onClick={onClose}>×</button>
        </div>
        {groups.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {groups.map(({ g, total }) => (
              <li key={g} className="flex items-center gap-2 rounded-lg bg-fill px-3 py-1 text-sm">
                <span>{`第 ${g + 1} 组`}</span><strong>{total}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-2">
              <tr><th>名次</th><th>姓名</th><th>积分</th><th>加分次数</th><th>扣分次数</th></tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.seat.enrollment_id} className="border-t border-line">
                  <td>{r.rank}</td><td>{r.seat.name}</td><td>{r.total}</td><td>{r.plus}</td><td>{r.minus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
