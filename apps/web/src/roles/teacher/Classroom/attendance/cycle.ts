import type { AttendanceStatus } from '@/shared/types/attendance'

export type MarkStatus = AttendanceStatus | 'present'

const NEXT: Record<MarkStatus, MarkStatus> = {
  present: 'leave',
  leave: 'absent',
  absent: 'late',
  late: 'present',
}

export function nextStatus(s: MarkStatus): MarkStatus {
  return NEXT[s]
}

export const ATTENDANCE_LABEL: Record<
  AttendanceStatus,
  { text: '请假' | '缺勤' | '迟到'; tone: 'amber' | 'red' | 'blue' }
> = {
  leave: { text: '请假', tone: 'amber' },
  absent: { text: '缺勤', tone: 'red' },
  late: { text: '迟到', tone: 'blue' },
}
