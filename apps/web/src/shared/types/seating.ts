export interface SeatingSave {
  base_version: number
  rows: number
  cols: number
  seats: { enrollment_id: string; row: number; col: number; locked: boolean }[]
}

export interface SeatingSaved {
  version: number
  rows: number
  cols: number
}

export type DeskSize = 1 | 2 | 3
export type SeatLayoutMode = 'auto' | 'manual'
export type SeatOrder = 'row' | 'col'
export type LayoutHow = 'keep' | 'row' | 'col'

export interface LayoutDraft {
  desk_size: DeskSize
  seat_layout: SeatLayoutMode
  rows: number
  cols: number | null
  podium_left: number
  podium_right: number
  how: LayoutHow
}
export interface LayoutSave extends LayoutDraft {
  base_version: number
  room: string
}
export interface LayoutPreview {
  rows: number
  cols: number
  seats: { enrollment_id: string; row: number; col: number }[]
  capacity: number
  students: number
  unseated: number
}
export interface LayoutSaved {
  version: number
  moved: boolean
  rows: number
  cols: number
}
