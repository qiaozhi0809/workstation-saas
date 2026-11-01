export interface ClassView {
  id: string; name: string; grade_name: string
  seat_rows: number; seat_cols: number
  role: 'homeroom_teacher' | 'subject_teacher' | 'assistant_teacher'
}
