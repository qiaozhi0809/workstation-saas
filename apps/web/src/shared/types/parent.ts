import type { ExamType } from './grades'
import type { GrowthType } from './growth'
import type { StudentProfile } from './student'

// ---- 班主任管家长(parent.manage) ----
export type ParentRelation = '父亲' | '母亲' | '祖辈' | '其他'
export interface ParentOfStudent {
  link_id: string; user_id: string
  /** parents.name,家长称呼 */
  name: string
  relation: ParentRelation; phone: string
  is_primary: boolean
  status: 'active' | 'readonly'
  account_status: 'active' | 'frozen' | 'archived'
  /** 这个账号还有教职工身份(不能由班主任重置) */
  shared_account: boolean
  must_change_password: boolean
}
/** name 1..20,去首尾空格 */
export interface ParentInput { phone: string; name: string; relation: ParentRelation }
/** 绑到已有账号时 temp_password 为 null */
export interface ParentCreated { parent: ParentOfStudent; temp_password: string | null }

// ---- 家长端读接口 ----
export interface ParentChild {
  student_id: string; name: string; gender: string | null
  /** 在读班;只读历史时为最后一个班 */
  class_name: string | null; grade_name: string | null
  relation: ParentRelation; is_primary: boolean
  status: 'active' | 'readonly'
  /** 只读时:变为只读那天(学校本地日期) */
  left_on: string | null
  /** 只读时:left_on + 365 天 */
  archive_on: string | null
}
export interface MiniSeatMap {
  rows: number; cols: number; desk_size: 1 | 2 | 3
  podium_left: number; podium_right: number
  /** 全部有人的座位(含自己孩子),不带身份 */
  occupied: { row: number; col: number }[]
  /** 自己孩子没有座位时 null */
  mine: { row: number; col: number } | null
}
export interface ParentReview {
  id: string; reason_text: string; score_delta: number
  subject: string | null; given_at: string; given_by_name: string | null
}
export interface ParentToday {
  /** 学校本地日期 */
  date: string
  status: 'active' | 'readonly'
  /** 未确认且无记录时 null */
  attendance: { status: 'present' | 'leave' | 'absent' | 'late'; reason: string | null } | null
  attendance_confirmed: boolean
  /** 今日,时间倒序 */
  reviews: ParentReview[]
  /** 本周(周一起)积分,口径同教室积分榜;负向点评关时只加正分 */
  week_points: number
  class_info: { class_name: string; homeroom_name: string | null; teachers: { subject: string; name: string }[] } | null
  /** 只读时 null */
  enrollment_id: string | null
  /** 只读时 null */
  seat_map: MiniSeatMap | null
}
export type ParentProfile = Omit<StudentProfile, 'teacher_notes' | 'note'> & { can_edit_contacts: boolean }
export interface ParentGrowthRecord {
  id: string; type: GrowthType; date: string; content: string
  year_name: string; created_by_name: string | null
}
export interface ParentComment { id: string; semester: string; content: string; created_at: string }
export interface ParentExamItem {
  id: string; name: string; exam_type: ExamType; date: string; year_name: string; class_name: string
}
export interface ParentExamDetail {
  exam: ParentExamItem
  subjects: { name: string; full: number; score: number | null; class_avg: number | null; class_max: number | null }[]
  total: number | null; total_full: number
  /** 有总分的人数 */
  ranked: number
  /** 只在"家长可见排名"开时给 */
  class_rank: number | null
  /** 只在开关关时给;ranked < 10 时 null */
  band: '前 10%' | '前 30%' | null
}
export interface ParentReviewPage { items: ParentReview[]; next_cursor: string | null }
