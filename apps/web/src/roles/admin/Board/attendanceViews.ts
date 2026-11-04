import type { SeatView } from '@/shared/components/ClassroomMap/types'
import type { AttendanceStatus } from '@/shared/types/admin'

/** 座位小牌:颜色之外一定带文字(假 / 缺 / 迟) */
const CHIP: Record<AttendanceStatus, NonNullable<SeatView['chip']>> = {
  leave: { text: '假', tone: 'amber' },
  absent: { text: '缺', tone: 'red' },
  late: { text: '迟', tone: 'blue' },
}

export const STATUS_TEXT: Record<AttendanceStatus, string> = { leave: '请假', absent: '缺勤', late: '迟到' }

export function attendanceViews(attendance: Record<string, AttendanceStatus>): Record<string, SeatView> {
  const out: Record<string, SeatView> = {}
  for (const [id, status] of Object.entries(attendance)) {
    out[id] = { ghost: status !== 'late', chip: CHIP[status] }
  }
  return out
}

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
