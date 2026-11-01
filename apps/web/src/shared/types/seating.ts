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
