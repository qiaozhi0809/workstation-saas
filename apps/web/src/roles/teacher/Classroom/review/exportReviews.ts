import { formatInTz } from '@/shared/lib/date'
import type { Review } from '@/shared/types/review'
import type { RosterRow } from '../attendance/exportMonth'

export function reviewRows(
  items: Review[],
  roster: RosterRow[],
  timeZone: string,
): (string | number)[][] {
  const byId = new Map(roster.map((r) => [r.enrollment_id, r]))
  return [
    ['时间', '姓名', '学号', '分值', '理由', '科目'],
    ...items.map((it) => {
      const person = byId.get(it.enrollment_id)
      return [
        formatInTz(it.given_at, timeZone),
        person?.name ?? '',
        person?.student_no ?? '',
        it.score_delta,
        it.reason_text,
        it.subject ?? '',
      ]
    }),
  ]
}
