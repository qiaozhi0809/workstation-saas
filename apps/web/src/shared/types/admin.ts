import type { ExamType, SubjectFull } from './grades'
import type { Stage as StageKey } from './school'
import type { StudentSeat } from './student'

export type Context = 'teacher' | 'admin' | 'parent'
export type AdminPerm =
  | 'school.view' // 计算得出:有校长 / 主任 / 年级组长任一身份(能看业务数据)
  | 'org.manage'
  | 'account.manage'
  | 'settings.manage'
  | 'audit.read'
  | 'ai.usage'
  | 'notice.send'
  | 'exam.grade_write'
  | 'year.upgrade'
  | 'camera.manage'
  | 'camera.view'

export interface UserBrief {
  id: string
  display_name: string
  contexts: Context[]
  admin_perms: AdminPerm[]
  must_change_password: boolean
  /** 为真当且仅当 must_change_password 为真;first_login 优先。
   * 'required' 只由前端写:会话中撞到 403 PASSWORD_CHANGE_REQUIRED 而取不到服务端原因时的兜底 */
  password_change_reason: 'first_login' | 'expired' | 'required' | null
}
export interface ChangePassword {
  old_password: string
  new_password: string
  refresh_token: string
}

export type Stage = '小学' | '初中' | '高中'
export interface SchoolInfo {
  name: string
  address: string | null
}
export interface YearAdmin {
  id: string
  name: string
  start_date: string
  end_date: string
  term2_start: string | null
  is_active: boolean
}
export interface YearUpdate {
  name: string
  start_date: string
  end_date: string
  term2_start: string | null
}
export interface GradeAdmin {
  id: string
  name: string
  stage: Stage | null
  effective_stage: Stage
  display_order: number
  class_count: number
}
export interface GradeInput {
  name: string
  stage: Stage | null
  display_order: number
}
export interface StaffBrief {
  assignment_id: string
  user_id: string
  /** 后端 StaffBrief 一直带 teacher_id,前端类型补齐,选人高亮按它比对(L55) */
  teacher_id: string
  display_name: string
}
export interface ClassAdmin {
  id: string
  name: string
  grade_id: string
  grade_name: string
  room: string
  student_count: number
  homeroom: StaffBrief | null
  assistants: StaffBrief[]
  subjects: { subject: string; teachers: StaffBrief[] }[]
  desk_size: 1 | 2 | 3
  seat_layout: 'auto' | 'manual'
  seat_rows: number
  seat_cols: number
  podium_left: number
  podium_right: number
}
export interface ClassInput {
  grade_id: string
  name: string
  room: string
}
export interface StaffInput {
  user_id: string
  identity: 'homeroom' | 'assistant' | 'subject'
  subject: string | null
}
export type AdminRoleType = 'principal' | 'dean' | 'grade_head' | 'it_admin'
export interface AdminRole {
  binding_id: string
  user_id: string
  display_name: string
  role: AdminRoleType
  grade_id: string | null
  grade_name: string | null
}
export interface AdminRoleInput {
  user_id: string
  role: AdminRoleType
  grade_id: string | null
}

export interface RoleTag {
  role: string
  label: string
}
export interface Account {
  id: string
  login_name: string
  display_name: string
  phone: string | null
  employee_no: string | null
  subjects: string[]
  status: 'active' | 'frozen'
  must_change_password: boolean
  last_login_at: string | null
  roles: RoleTag[]
  totp_enabled: boolean
}
export interface AccountInput {
  display_name: string
  phone: string | null
  employee_no: string | null
  subjects: string[]
}
export interface AccountCreate extends AccountInput {
  login_name: string
}
export interface AccountPage {
  items: Account[]
  total: number
}
export interface ImportRow {
  line: number
  login_name: string
  display_name: string
  employee_no: string | null
  subjects: string[]
  phone: string | null
  error: string | null
}

export interface TagPool {
  tags: string[]
}
export interface TagPoolSave {
  tags: string[]
  renames: { from: string; to: string }[]
}
export interface Switches {
  parent_rank: boolean
  parent_negative_review: boolean
  teacher_review_frequency: boolean
  monitor: boolean
  parent_monitor: boolean
  ai_review_before_send: boolean
  star_of_week: boolean
  birthdays: boolean
}

export type AttendanceStatus = 'leave' | 'absent' | 'late'
export interface TodayView {
  date: string
  scope_label: string
  totals: {
    students: number
    present: number
    leave: number
    absent: number
    late: number
    classes: number
    confirmed_classes: number
  }
  absentees: {
    class_id: string
    class_name: string
    student_id: string
    name: string
    status: 'leave' | 'absent'
    reason: string | null
  }[]
  unconfirmed: { class_id: string; class_name: string; homeroom_name: string | null }[]
  week_reviews: {
    classes: { class_id: string; class_name: string; plus: number; minus: number; net: number }[]
    bottom: {
      class_id: string
      class_name: string
      student_id: string
      name: string
      net: number
    }[]
    teachers: { user_id: string; display_name: string; count: number }[]
  }
  grade_exam?: {
    id: string
    name: string
    grade_name: string
    entered: number
    expected: number
  } | null
  my_notices?: { id: string; title: string; created_at: string; recipients: number; read: number }[]
}
export interface BoardClass {
  id: string
  cameras: number
  name: string
  room: string
  homeroom_name: string | null
  seat_rows: number
  seat_cols: number
  desk_size: 1 | 2 | 3
  podium_left: number
  podium_right: number
  seats: StudentSeat[]
  attendance: Record<string, AttendanceStatus>
  metrics: {
    students: number
    present: number
    leave: number
    absent: number
    late: number
    confirmed: boolean
    week_net: number
  }
}
/**
 * 年级简项(后端 overview/schemas.py::GradeBrief,V3-4):看板与 GET /school/grades 共用,按调用者可见年级裁剪。
 * effective_stage 是年级显式设的学段、否则按名字推断的学段键(科目目录按它取);契约允许为 null
 */
export interface GradeBrief {
  id: string
  name: string
  effective_stage: StageKey | null
}
/** GET /school/grades 的一项(school.view 可读;年级组长只拿到自己的年级,L272) */
export interface SchoolGrade extends GradeBrief {
  display_order: number
}
export interface BoardView {
  grades: GradeBrief[]
  grade_id: string | null
  classes: BoardClass[]
}

// ---- M3b:年级联考 ----
export interface GradeExamClass {
  class_id: string
  class_name: string
  exam_id: string
  entered: number
  expected: number
}
export interface GradeExam {
  id: string
  grade_id: string
  grade_name: string
  name: string
  exam_type: ExamType
  date: string
  subjects: SubjectFull[]
  classes: GradeExamClass[]
  missing_classes: { class_id: string; class_name: string }[]
}
export interface GradeExamInput {
  grade_id: string
  name: string
  exam_type: ExamType
  date: string
  subjects: SubjectFull[]
}

// ---- 成绩汇总 ----
export interface SubjectStat {
  subject: string
  full: number
  count: number
  missing: number
  avg: number | null
  max: number | null
  min: number | null
  pass_rate: number | null
  good_rate: number | null
}
export interface TotalStat {
  full: number
  count: number
  avg: number | null
  max: number | null
  min: number | null
}
export interface ScoreSummary {
  grade_exam: { id: string; name: string; date: string; grade_name: string }
  subjects: SubjectFull[]
  classes: { class_id: string; class_name: string; subjects: SubjectStat[]; total: TotalStat }[]
  grade: { subjects: SubjectStat[]; total: TotalStat }
}
export interface ScoreStudentRow {
  student_id: string
  name: string
  student_no: string | null
  class_id: string
  class_name: string
  scores: Record<string, number | null>
  total: number | null
  class_rank: number | null
  grade_rank: number | null
}

// ---- 月度考勤报告 ----
export interface AttendanceCounts {
  days: number
  expected: number
  present: number
  leave: number
  absent: number
  late: number
  rate: number | null
}
export interface AttendanceReport {
  month: string
  scope_label: string
  classes: ({ class_id: string; class_name: string; grade_name: string } & AttendanceCounts)[]
  total: AttendanceCounts
}
export interface AttendanceClassDetail {
  month: string
  class_id: string
  class_name: string
  days: number
  students: {
    student_id: string
    name: string
    student_no: string | null
    leave: number
    absent: number
    late: number
  }[]
}

// ---- 审计 ----
export interface AuditRow {
  id: string
  at: string
  user_id: string | null
  user_name: string | null
  action: string
  action_label: string
  object_type: string | null
  object_id: string | null
  object_label: string | null
  ip: string | null
  success: boolean
  extra: Record<string, unknown> | null
}
export interface AuditActions {
  groups: { key: string; label: string; actions: { action: string; label: string }[] }[]
  /** 可筛选的对象类型及中文名,由后端随动作表一起给(V3-4;L271) */
  object_types: { key: string; label: string }[]
}

// ---- AI 使用与配置 ----
export interface AiUsageRow {
  user_id: string
  display_name: string
  calls: number
  failed: number
  prompt_tokens: number
  completion_tokens: number
  top_templates: { template: string; label: string; count: number }[]
}
export interface AiUsage {
  month: string
  rows: AiUsageRow[]
  total: { calls: number; failed: number; prompt_tokens: number; completion_tokens: number }
}
export interface AiConfigView {
  provider: string | null
  base_url: string | null
  model: string | null
  temperature: number | null
  mask_forced: boolean
  key_set: boolean
  key_undecryptable: boolean
  providers: { id: string; label: string; base_url: string; models: string[] }[]
}
export interface AiConfigSave {
  provider: string
  base_url: string
  model: string
  temperature: number
  mask_forced: boolean
  api_key: string | null
}

// ---- 通知 ----
export type NoticeTarget =
  | { kind: 'school' }
  | { kind: 'grade'; grade_id: string }
  | { kind: 'class'; class_id: string }
  | { kind: 'users'; user_ids: string[] }
export type AckSpec =
  | { kind: 'none' }
  | { kind: 'confirm' }
  | { kind: 'choice'; options: string[]; allow_note: boolean }
export type Audience = 'teachers' | 'parents'
export interface NoticeInput {
  title: string
  content: string
  target: NoticeTarget
  audience?: Audience
  ack?: AckSpec
  ack_deadline?: string | null
}
export interface NoticeSent {
  id: string
  title: string
  content: string
  target_label: string
  created_at: string
  recalled_at: string | null
  recipients: number
  read: number
  audience: Audience
  ack: AckSpec
  ack_deadline: string | null
  acked: number
  students_without_parent: number
}
export interface InboxItem {
  id: string
  title: string
  content: string | null
  from_name: string | null
  created_at: string
  read_at: string | null
  recalled: boolean
  ack: AckSpec
  ack_deadline: string | null
  my_ack: { choice: number | null; note: string | null; acked_at: string } | null
  students: string[]
  /** students 的明细:姓名 + 发送时的班名快照(L87);students 仍是字符串列表,第 2 波前端再切换 */
  students_detail: { name: string; class_name: string | null }[]
  can_ack: boolean
  /** can_ack 为假时后端给出的原因,为真时 null(L88) */
  ack_block_reason: AckBlockReason
}
export type AckBlockReason = 'closed' | 'recalled' | 'readonly' | 'not_primary' | null
export interface NoticeOptions {
  school_wide: boolean
  grades: { id: string; name: string }[]
  classes: { id: string; name: string; grade_id: string }[]
}
export interface AckInput {
  choice: number | null
  note: string | null
}
export interface AckRow {
  user_id: string
  user_name: string
  student_id: string | null
  student_name: string | null
  class_name: string | null
  read_at: string | null
  choice: number | null
  note: string | null
  acked_at: string | null
}
export interface AckStats {
  audience: Audience
  ack: AckSpec
  ack_deadline: string | null
  total: number
  read: number
  acked: number
  counts: number[]
  students_without_parent: number
  rows: AckRow[]
}
export interface ClassNoticeInput {
  title: string
  content: string
  ack?: AckSpec
  ack_deadline?: string | null
}
export interface Inbox {
  items: InboxItem[]
  total: number
  unread: number
}
export interface NoticePerson {
  user_id: string
  name: string
  tags: string[]
}
export interface NoticeRecipients {
  read: { user_id: string; name: string; read_at: string }[]
  unread: { user_id: string; name: string }[]
}

// ---- 学年升级 ----
export interface UpgradeClassPlan {
  from_class_id: string
  from_name?: string | null
  action: 'promote' | 'graduate'
  to_grade_name?: string | null
  to_name?: string | null
  homeroom_teacher_id?: string | null
  teacher_name?: string | null
  keep_teachers: boolean
}
export interface UpgradeStudentPlan {
  enrollment_id: string
  name?: string | null
  action: 'repeat' | 'leave'
  to?: { successor_of?: string | null; new_class?: number | null } | null
}
export interface UpgradeNewClassPlan {
  grade_name: string
  name: string
  homeroom_teacher_id?: string | null
  seat_rows: number
  seat_cols: number
  desk_size: 1 | 2 | 3
  seat_layout: 'auto' | 'manual'
}
export interface GradeHeadPlan {
  grade_name: string
  user_ids: string[]
}
export interface UpgradePlan {
  version: 1
  from_year_id: string
  new_year: { name: string; start_date: string; end_date: string }
  classes: UpgradeClassPlan[]
  students: UpgradeStudentPlan[]
  new_classes: UpgradeNewClassPlan[]
  grade_heads?: GradeHeadPlan[] | null
}
export interface ClassPreview {
  from_name: string
  /** 升级班沿用方案里的 promote / graduate,新建班是 new;后端只会给这三个值(L53) */
  action: 'promote' | 'graduate' | 'new'
  to_label: string
  teacher_name: string | null
  follow: number
  repeat_in: number
  repeat_out: number
  leave: number
  graduate: number
}
export interface UpgradePreview {
  new_year: string
  classes: ClassPreview[]
  new_classes: string[]
  warnings: string[]
}
export interface UpgradeLatest {
  id: string
  executed_at: string
  from_year_name: string
  to_year_name: string
  rolled_back: boolean
}

// ---- 往年班级只读查看 ----
export interface HistoryYear {
  id: string
  name: string
  start_date: string
  end_date: string
}
export interface HistoryClass {
  class_id: string
  class_name: string
  grade_name: string
  homeroom_name: string | null
  students: number
}
export interface HistoryStudent {
  student_id: string
  name: string
  student_no: string | null
  status: string
}
export interface HistoryExam {
  id: string
  name: string
  exam_type: ExamType
  date: string
  subjects: SubjectFull[]
}
export interface HistoryScores {
  exam: HistoryExam
  students: {
    student_id: string
    name: string
    student_no: string | null
    scores: Record<string, number | null>
    total: number | null
    class_rank: number | null
  }[]
}

export interface SystemInfo {
  version: string
  migration: string
  started_at: string
  db_size_bytes: number
  /** caddy:上次备份是否包含网关数据(backup.sh 写进 backup-last.json,V3-4 / V5);旧记录没有这一项时为 null(L277) */
  last_backup: {
    at: string
    file: string
    size_bytes: number
    caddy: 'included' | 'skipped' | null
  } | null
}

export interface SecuritySettings {
  totp_allowed: boolean
  /** 8..32 */
  password_min_length: number
  password_max_age_days: 0 | 90 | 180 | 365
}

export type LoginResult =
  'success' | 'bad_password' | 'unknown_user' | 'inactive' | 'locked' | 'totp_failed'
export type LoginSuspicion = 'night' | 'new_network'
export interface LoginLog {
  id: string
  at: string
  login_name: string
  user: { id: string; display_name: string } | null
  result: LoginResult
  ip: string | null
  user_agent: string | null
  suspicious: LoginSuspicion[]
}
export interface LoginLogPage {
  items: LoginLog[]
  total: number
  page: number
  page_size: number
}
