import type { StudentSeat } from '@/shared/types/student'

export type ClassroomMode = 'daily' | 'overview' | 'mini'

export interface ClassroomMapProps {
  seats: StudentSeat[]
  rows: number
  cols: number
  mode?: ClassroomMode
  onSeatClick?: (seat: StudentSeat) => void
}
