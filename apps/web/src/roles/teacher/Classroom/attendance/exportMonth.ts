import { daysInMonth } from '@/shared/lib/date'
import { compareRoster } from '@/shared/lib/rosterOrder'
import type { AttendanceMonth, AttendanceStatus } from '@/shared/types/attendance'
import { ATTENDANCE_LABEL } from './cycle'

export interface RosterRow {
  enrollment_id: string
  name: string
  student_no: string | null
}

export function attendanceMonthRows(
  month: string,
  roster: RosterRow[],
  items: AttendanceMonth['items'],
): (string | number)[][] {
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => String(i + 1).padStart(2, '0'))
  const byPerson = new Map<string, Map<string, AttendanceStatus>>()
  for (const it of items) {
    const m = byPerson.get(it.enrollment_id) ?? new Map<string, AttendanceStatus>()
    m.set(it.date, it.status)
    byPerson.set(it.enrollment_id, m)
  }
  const header = ['学号', '姓名', ...days, '请假', '缺勤', '迟到']
  const body = [...roster].sort(compareRoster).map((r) => {
    const marks = byPerson.get(r.enrollment_id)
    const statuses = days.map((d) => marks?.get(`${month}-${d}`))
    const count = (s: AttendanceStatus) => statuses.filter((x) => x === s).length
    return [
      r.student_no ?? '',
      r.name,
      ...statuses.map((s) => (s ? ATTENDANCE_LABEL[s].text : '')),
      count('leave'),
      count('absent'),
      count('late'),
    ]
  })
  return [header, ...body]
}
