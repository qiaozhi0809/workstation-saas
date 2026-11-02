import type { AttendanceStatus } from '@/shared/types/attendance'

export type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral'

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  danger: 'text-destructive',
  neutral: 'text-muted-foreground',
}

export const TONE_FILL: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
}

export const ATTENDANCE_TONE: Record<AttendanceStatus | 'present', Tone> = {
  present: 'success',
  leave: 'warning',
  absent: 'danger',
  late: 'info',
}

export function scoreTone(delta: number): Tone {
  if (delta > 0) return 'success'
  if (delta < 0) return 'danger'
  return 'neutral'
}
