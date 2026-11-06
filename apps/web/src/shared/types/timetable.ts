export interface Period {
  no: number
  starts_at: string
  ends_at: string
}
export interface TimetableCell {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7
  period_no: number
  subject: string
  teacher: { id: string; name: string } | null
}
export interface ClassTimetable {
  class_id: string
  class_name: string
  cells: TimetableCell[]
}
export interface TimetableCellInput {
  weekday: TimetableCell['weekday']
  period_no: number
  subject: string
  teacher_id: string | null
}
export interface TimetableImportResult {
  ok: boolean
  written: number
  errors: { line: number; message: string }[]
}
