import { useMemo } from 'react'
import Modal from '@/shared/components/overlay/Modal'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import type { ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'

/** 积分榜:小组积分(按座位列分组,未排座不计)+ 学生榜(同分并列,下一名跳号)。 */
export default function Leaderboard({
  roster,
  summary,
  groupOf,
  onClose,
}: {
  roster: StudentSeat[]
  /** 座位所属小组序号(0 起),与地图着色一致 */
  groupOf(seat: StudentSeat): number
  summary: ReviewSummary | undefined
  onClose(): void
}) {
  const { groups, rows } = useMemo(() => {
    const totals = new Map((summary?.items ?? []).map((t) => [t.enrollment_id, t]))
    const people = roster
      .map((s) => {
        const t = totals.get(s.enrollment_id)
        return {
          seat: s,
          total: t?.total ?? 0,
          plus: t?.plus_count ?? 0,
          minus: t?.minus_count ?? 0,
        }
      })
      .sort((a, b) => b.total - a.total)
    const byGroup = new Map<number, number>()
    for (const p of people) {
      if (p.seat.seat_col == null) continue
      const g = groupOf(p.seat)
      byGroup.set(g, (byGroup.get(g) ?? 0) + p.total)
    }
    return {
      groups: [...byGroup]
        .map(([g, total]) => ({ g, total }))
        .sort((a, b) => b.total - a.total || a.g - b.g),
      rows: people.map((p, i) => ({
        ...p,
        rank: i > 0 && people[i - 1].total === p.total ? 0 : i + 1,
      })),
    }
  }, [roster, summary, groupOf])
  // 并列取上一名的名次
  let last = 0
  const ranked = rows.map((r) => {
    last = r.rank || last
    return { ...r, rank: last }
  })

  return (
    <Modal open onClose={onClose} title="积分榜" className="sm:max-w-[480px]">
      {groups.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {groups.map(({ g, total }) => (
            <li key={g} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm">
              <span>{`第 ${g + 1} 组`}</span>
              <strong className="tabular-nums">{total}</strong>
            </li>
          ))}
        </ul>
      )}
      <Table
        density="compact"
        containerClassName="max-h-[60vh] overflow-y-auto rounded-none bg-transparent shadow-none"
      >
        <TableHead className="sticky top-0 bg-background">
          <TableRow>
            <Th>名次</Th>
            <Th>姓名</Th>
            <Th numeric>积分</Th>
            <Th numeric>加分次数</Th>
            <Th numeric>扣分次数</Th>
          </TableRow>
        </TableHead>
        <TableBody>
          {ranked.map((r) => (
            <TableRow key={r.seat.enrollment_id}>
              <Td className="tabular-nums">{r.rank}</Td>
              <Td>{r.seat.name}</Td>
              <Td numeric>{r.total}</Td>
              <Td numeric>{r.plus}</Td>
              <Td numeric>{r.minus}</Td>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Modal>
  )
}
