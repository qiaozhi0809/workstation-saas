export type ClassPerm =
  | 'attendance.read'
  | 'attendance.write'
  | 'review.read'
  | 'review.write'
  | 'seating.write'
  | 'board.write'
  | 'student.write_basic'
  | 'exam.read'
  | 'exam.write'
  | 'score.write'
  | 'score.export'
  | 'student.manage'
  | 'student.export'
  | 'growth.read'
  | 'growth.write'
  | 'comment.read'
  | 'comment.write'
  | 'ai.use'
  | 'ai.class'

export interface Board {
  left_title: string
  left_text: string
  right_title: string
  right_text: string
  countdown_label: string | null
  countdown_date: string | null
}

export interface ClassroomSummary {
  today: string
  timezone: string
  week_no: number
  school_name: string
  week_start: string
  year: { id: string; name: string; start_date: string; end_date: string }
  seat_version: number
  my_perms: ClassPerm[]
  my_subjects: string[]
  board: Board
  switches?: { star_of_week: boolean; birthdays: boolean }
}
