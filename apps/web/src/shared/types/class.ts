import type { DeskSize, SeatLayoutMode, SeatOrder } from './seating'

export interface ClassView {
  id: string
  name: string
  grade_name: string
  seat_rows: number
  seat_cols: number
  role: 'homeroom_teacher' | 'subject_teacher' | 'assistant_teacher'
  desk_size: DeskSize
  seat_layout: SeatLayoutMode
  seat_order: SeatOrder
  podium_left: number
  podium_right: number
  room: string
}
