import { daysUntilBirthday } from '@/shared/lib/date'
import { compareRoster } from '@/shared/lib/rosterOrder'
import type { StudentRecord } from '@/shared/types/student'

export type RosterFilter = 'all' | 'male' | 'female' | 'cadre' | 'focus' | 'boarding' | 'birthday' | 'unseated'
export type RosterSort = 'no' | 'name' | 'rank' | 'points' | 'birthday'

export interface RosterRow extends StudentRecord {
  rank: number | null
  rankChange: number | null
  points: number | null
  daysToBirthday: number | null
}

/** ranks / points 都以 enrollment_id 为键;points 为 null = 无积分权限。 */
export function buildRows(
  records: StudentRecord[],
  ranks: Map<string, { rank: number | null; change: number | null }>,
  points: Map<string, number> | null,
  today: string,
): RosterRow[] {
  return records.map((r) => ({
    ...r,
    rank: ranks.get(r.enrollment_id)?.rank ?? null,
    rankChange: ranks.get(r.enrollment_id)?.change ?? null,
    points: points ? points.get(r.enrollment_id) ?? 0 : null,
    daysToBirthday: r.birthdate ? daysUntilBirthday(r.birthdate, today) : null,
  }))
}

const matches: Record<RosterFilter, (r: RosterRow, today: string) => boolean> = {
  all: () => true,
  male: (r) => r.gender === '男',
  female: (r) => r.gender === '女',
  cadre: (r) => !!r.class_role,
  focus: (r) => !!r.tags?.includes('重点关注'),
  boarding: (r) => r.boarding === true || !!r.tags?.includes('住校'),
  birthday: (r, today) => !!r.birthdate && r.birthdate.slice(5, 7) === today.slice(5, 7),
  unseated: (r) => r.seat_row === null || r.seat_col === null,
}

export function filterRows(rows: RosterRow[], q: string, filter: RosterFilter, today: string): RosterRow[] {
  const needle = q.trim().toLowerCase()
  return rows.filter((r) => {
    if (!matches[filter](r, today)) return false
    if (!needle) return true
    return [r.name, r.student_no ?? '', ...(r.tags ?? [])].some((t) => t.toLowerCase().includes(needle))
  })
}

const collator = new Intl.Collator('zh-CN', { numeric: true })

/** 空值始终排在最后,不随方向翻转。 */
export function sortRows(rows: RosterRow[], sort: RosterSort, dir: 'asc' | 'desc'): RosterRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const key = (r: RosterRow): string | number | null => {
    switch (sort) {
      case 'no': return null // 学号走 compareRoster,见下
      case 'name': return r.name
      case 'rank': return r.rank
      case 'points': return r.points
      case 'birthday': return r.daysToBirthday
    }
  }
  return [...rows].sort((a, b) => {
    if (sort === 'no') {
      if (!a.student_no !== !b.student_no) return a.student_no ? -1 : 1
      return compareRoster(a, b) * sign
    }
    const x = key(a)
    const y = key(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
    return c * sign
  })
}
