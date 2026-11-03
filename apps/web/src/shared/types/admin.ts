import type { StudentSeat } from './student'

export type Context = 'teacher' | 'admin'
export type AdminPerm =
  | 'school.view' // 计算得出:有校长 / 主任 / 年级组长任一身份(能看业务数据)
  | 'org.manage' | 'account.manage' | 'settings.manage' | 'audit.read'
  | 'ai.usage' | 'notice.send' | 'exam.grade_write' | 'year.upgrade'

export interface UserBrief {
  id: string; display_name: string
  contexts: Context[]
  admin_perms: AdminPerm[]
  must_change_password: boolean
}
export interface ChangePassword { old_password: string; new_password: string; refresh_token: string }

export type Stage = '小学' | '初中' | '高中'
export interface SchoolInfo { name: string; address: string | null }
export interface YearAdmin {
  id: string; name: string; start_date: string; end_date: string
  term2_start: string | null; is_active: boolean
}
export interface YearUpdate { name: string; start_date: string; end_date: string; term2_start: string | null }
export interface GradeAdmin { id: string; name: string; stage: Stage | null; effective_stage: Stage; display_order: number; class_count: number }
export interface GradeInput { name: string; stage: Stage | null; display_order: number }
export interface StaffBrief { assignment_id: string; user_id: string; display_name: string }
export interface ClassAdmin {
  id: string; name: string; grade_id: string; grade_name: string; room: string
  student_count: number
  homeroom: StaffBrief | null
  assistants: StaffBrief[]
  subjects: { subject: string; teachers: StaffBrief[] }[]
  desk_size: 1 | 2 | 3; seat_layout: 'auto' | 'manual'
  seat_rows: number; seat_cols: number; podium_left: number; podium_right: number
}
export interface ClassInput { grade_id: string; name: string; room: string }
export interface StaffInput { user_id: string; identity: 'homeroom' | 'assistant' | 'subject'; subject: string | null }
export type AdminRoleType = 'principal' | 'dean' | 'grade_head' | 'it_admin'
export interface AdminRole { binding_id: string; user_id: string; display_name: string; role: AdminRoleType; grade_id: string | null; grade_name: string | null }
export interface AdminRoleInput { user_id: string; role: AdminRoleType; grade_id: string | null }

export interface RoleTag { role: string; label: string }
export interface Account {
  id: string; login_name: string; display_name: string
  phone: string | null; employee_no: string | null; subjects: string[]
  status: 'active' | 'frozen'; must_change_password: boolean
  last_login_at: string | null; roles: RoleTag[]
}
export interface AccountInput { display_name: string; phone: string | null; employee_no: string | null; subjects: string[] }
export interface AccountCreate extends AccountInput { login_name: string }
export interface AccountPage { items: Account[]; total: number }
export interface ImportRow { line: number; login_name: string; display_name: string; employee_no: string | null; subjects: string[]; phone: string | null; error: string | null }

export interface TagPool { tags: string[] }
export interface TagPoolSave { tags: string[]; renames: { from: string; to: string }[] }
export interface Switches {
  parent_rank: boolean; parent_negative_review: boolean; teacher_review_frequency: boolean
  monitor: boolean; parent_monitor: boolean; ai_review_before_send: boolean
  star_of_week: boolean; birthdays: boolean
}

export type AttendanceStatus = 'leave' | 'absent' | 'late'
export interface TodayView {
  date: string; scope_label: string
  totals: { students: number; present: number; leave: number; absent: number; late: number; classes: number; confirmed_classes: number }
  absentees: { class_id: string; class_name: string; student_id: string; name: string; status: 'leave' | 'absent'; reason: string | null }[]
  unconfirmed: { class_id: string; class_name: string; homeroom_name: string | null }[]
  week_reviews: {
    classes: { class_id: string; class_name: string; plus: number; minus: number; net: number }[]
    bottom: { class_id: string; class_name: string; student_id: string; name: string; net: number }[]
    teachers: { user_id: string; display_name: string; count: number }[]
  }
}
export interface BoardClass {
  id: string; name: string; room: string; homeroom_name: string | null
  seat_rows: number; seat_cols: number; desk_size: 1 | 2 | 3; podium_left: number; podium_right: number
  seats: StudentSeat[]
  attendance: Record<string, AttendanceStatus>
  metrics: { students: number; present: number; leave: number; absent: number; late: number; confirmed: boolean; week_net: number }
}
export interface BoardView { grades: { id: string; name: string }[]; grade_id: string | null; classes: BoardClass[] }
