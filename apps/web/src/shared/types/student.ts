export interface StudentSeat {
  enrollment_id: string
  student_id: string
  name: string
  mk: string
  seat_row: number | null
  seat_col: number | null
  avatar_seed: string | null
  gender: string | null
  student_no: string | null
  birthdate: string | null
  class_role: string | null
  seat_locked: boolean
}
export interface StudentProfile {
  id: string
  enrollment_id: string
  mk: string
  name: string
  class_id: string
  gender?: string
  student_no?: string
  birthdate?: string
  avatar_seed?: string
  class_role?: string
  family_structure?: string
  learning_summary?: string
  personality?: string
  health_notes?: string
  tags?: string[]
  boarding?: boolean
  family_note?: string
  contacts?: Contact[]
  note?: string
  teacher_notes?: TeacherNote
}
export interface TeacherNote {
  text: string
  updated_at: string
}

export interface Contact {
  name: string
  relation: string
  phone: string
  job: string
}

export interface StudentRecord extends StudentSeat {
  boarding?: boolean
  family_structure?: string | null
  family_note?: string | null
  contacts?: Contact[]
  learning_summary?: string | null
  personality?: string | null
  health_notes?: string | null
  tags?: string[]
  note?: string | null
}

export interface StudentInput {
  name: string
  gender: '男' | '女' | null
  student_no: string | null
  birthdate: string | null
  class_role: string | null
  tags: string[]
  boarding: boolean
  family_structure: string | null
  family_note: string | null
  learning_summary: string | null
  personality: string | null
  note: string | null
  health_notes: string | null
  contacts: Contact[]
  seat: { row: number; col: number } | null
  auto_seat?: boolean
}
export interface StudentImport {
  rows: Omit<StudentInput, 'seat'>[]
  auto_seat: boolean
}
export interface StudentImported {
  created: number
  skipped: { index: number; reason: 'duplicate' | 'student_no_taken' }[]
}
