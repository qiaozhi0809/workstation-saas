export interface StudentSeat {
  enrollment_id: string; student_id: string; name: string; mk: string
  seat_row: number | null; seat_col: number | null; avatar_seed: string | null
}
export interface StudentProfile {
  id: string; mk: string; name: string; class_id: string
  gender?: string; student_no?: string; birthdate?: string; avatar_seed?: string
  family_structure?: string; learning_summary?: string
  personality?: string; health_notes?: string; tags?: string[]
  teacher_notes?: unknown
}
