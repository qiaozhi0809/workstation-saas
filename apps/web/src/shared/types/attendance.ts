export type AttendanceStatus = 'leave' | 'absent' | 'late'

export interface AttendanceRecord {
  enrollment_id: string
  status: AttendanceStatus
  reason: string | null
  marked_at: string
}

export interface AttendanceDay {
  date: string
  confirmed_at: string | null
  items: AttendanceRecord[]
}

export interface AttendanceUpdate {
  status: AttendanceStatus | 'present'
  reason?: string | null
}

export interface AttendanceUpdated {
  enrollment_id: string
  status: AttendanceStatus | 'present'
  reason: string | null
}

export interface AttendanceMonth {
  month: string
  items: { enrollment_id: string; date: string; status: AttendanceStatus }[]
}
