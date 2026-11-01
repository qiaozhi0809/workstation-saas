import type {
  AttendanceDay,
  AttendanceMonth,
  AttendanceUpdate,
  AttendanceUpdated,
} from '@/shared/types/attendance'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}/attendance`

export const attendanceApi = {
  day: (classId: string, date: string) =>
    api<AttendanceDay>('GET', `${base(classId)}?${new URLSearchParams({ date })}`),
  set: (classId: string, date: string, enrollmentId: string, body: AttendanceUpdate) =>
    api<AttendanceUpdated>(
      'PUT',
      `${base(classId)}/${encodeURIComponent(date)}/${encodeURIComponent(enrollmentId)}`,
      body,
    ),
  confirm: (classId: string, date: string, clearExceptions: boolean) =>
    api<AttendanceDay>('POST', `${base(classId)}/${encodeURIComponent(date)}/confirm`, {
      clear_exceptions: clearExceptions,
    }),
  month: (classId: string, month: string) =>
    api<AttendanceMonth>('GET', `${base(classId)}/month?${new URLSearchParams({ month })}`),
}
