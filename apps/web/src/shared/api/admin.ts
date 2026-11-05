import type {
  Account, AccountCreate, AccountInput, AccountPage, AdminRole, AdminRoleInput, AiConfigSave, AiConfigView,
  AiUsage, AttendanceClassDetail, AttendanceReport, AuditActions, AuditRow, BoardView,
  ClassAdmin, ClassInput, GradeAdmin, GradeExam, GradeExamInput, GradeInput, HistoryClass, HistoryExam,
  HistoryScores, HistoryStudent, HistoryYear, ImportRow, NoticeInput, NoticeOptions, NoticePerson,
  NoticeRecipients, NoticeSent, SchoolInfo, ScoreStudentRow, ScoreSummary, StaffInput, Switches,
  TagPool, TagPoolSave, TodayView, UpgradeLatest, UpgradePlan, UpgradePreview, YearAdmin, YearUpdate,
} from '@/shared/types/admin'
import { api, authedFetch, toApiError } from './client'

const seg = encodeURIComponent

/** 空值(undefined / null / '')不拼查询串 */
function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export interface AccountFilters { q?: string; role?: string; status?: string; page?: number }

export interface AuditFilters {
  from?: string; to?: string; user_id?: string; group?: string; action?: string
  object_type?: string; object_id?: string; success?: boolean; page?: number
}

/** 带 Bearer 下载文件(令牌走请求头,不进 URL);非 2xx 抛 ApiError */
async function download(path: string): Promise<Blob> {
  const res = await authedFetch('GET', path)
  if (!res.ok) throw await toApiError(res)
  return res.blob()
}

export const adminApi = {
  school: () => api<SchoolInfo>('GET', '/admin/school'),
  saveSchool: (b: SchoolInfo) => api<SchoolInfo>('PUT', '/admin/school', b),
  years: () => api<YearAdmin[]>('GET', '/admin/years'),
  saveYear: (id: string, b: YearUpdate) => api<YearAdmin>('PUT', `/admin/years/${seg(id)}`, b),
  grades: () => api<GradeAdmin[]>('GET', '/admin/grades'),
  createGrade: (b: GradeInput) => api<GradeAdmin>('POST', '/admin/grades', b),
  updateGrade: (id: string, b: GradeInput) => api<GradeAdmin>('PUT', `/admin/grades/${seg(id)}`, b),
  deleteGrade: (id: string) => api<void>('DELETE', `/admin/grades/${seg(id)}`),
  classes: (gradeId?: string | null) =>
    api<ClassAdmin[]>('GET', `/admin/classes${qs({ grade_id: gradeId })}`),
  class: (id: string) => api<ClassAdmin>('GET', `/admin/classes/${seg(id)}`),
  createClass: (b: ClassInput) => api<ClassAdmin>('POST', '/admin/classes', b),
  updateClass: (id: string, b: ClassInput) => api<ClassAdmin>('PUT', `/admin/classes/${seg(id)}`, b),
  deleteClass: (id: string) => api<void>('DELETE', `/admin/classes/${seg(id)}`),
  addStaff: (classId: string, b: StaffInput) =>
    api<ClassAdmin>('POST', `/admin/classes/${seg(classId)}/staff`, b),
  endStaff: (assignmentId: string) => api<void>('DELETE', `/admin/staff/${seg(assignmentId)}`),
  roles: () => api<AdminRole[]>('GET', '/admin/roles'),
  addRole: (b: AdminRoleInput) => api<AdminRole>('POST', '/admin/roles', b),
  endRole: (bindingId: string) => api<void>('DELETE', `/admin/roles/${seg(bindingId)}`),
  accounts: (f: AccountFilters = {}) =>
    api<AccountPage>('GET', `/admin/accounts${qs({ q: f.q, role: f.role, status: f.status, page: f.page })}`),
  createAccount: (b: AccountCreate) =>
    api<{ account: Account; temp_password: string }>('POST', '/admin/accounts', b),
  updateAccount: (id: string, b: AccountInput) => api<Account>('PUT', `/admin/accounts/${seg(id)}`, b),
  resetPassword: (id: string) =>
    api<{ temp_password: string }>('POST', `/admin/accounts/${seg(id)}/reset-password`),
  freeze: (id: string) => api<Account>('POST', `/admin/accounts/${seg(id)}/freeze`),
  unfreeze: (id: string) => api<Account>('POST', `/admin/accounts/${seg(id)}/unfreeze`),
  importPreview: (csv: string) =>
    api<{ rows: ImportRow[] }>('POST', '/admin/accounts/import/preview', { csv }),
  importAccounts: (csv: string) =>
    api<{ created: { login_name: string; display_name: string; temp_password: string }[] }>(
      'POST', '/admin/accounts/import', { csv }),
  saveTagPool: (b: TagPoolSave) => api<TagPool>('PUT', '/admin/settings/tag-pool', b),
  switches: () => api<Switches>('GET', '/admin/settings/switches'),
  saveSwitches: (b: Switches) => api<Switches>('PUT', '/admin/settings/switches', b),
  today: () => api<TodayView>('GET', '/admin/today'),
  board: (gradeId?: string | null) =>
    api<BoardView>('GET', `/admin/board${qs({ grade_id: gradeId })}`),
  // ---- 年级联考 ----
  gradeExams: (gradeId?: string | null) =>
    api<GradeExam[]>('GET', `/admin/grade-exams${qs({ grade_id: gradeId })}`),
  createGradeExam: (b: GradeExamInput) => api<GradeExam>('POST', '/admin/grade-exams', b),
  updateGradeExam: (id: string, b: GradeExamInput) =>
    api<GradeExam>('PUT', `/admin/grade-exams/${seg(id)}`, b),
  deleteGradeExam: (id: string) => api<void>('DELETE', `/admin/grade-exams/${seg(id)}`),
  syncGradeExam: (id: string) => api<GradeExam>('POST', `/admin/grade-exams/${seg(id)}/sync`),
  // ---- 成绩汇总 / 考勤报告 ----
  scoreReport: (gradeExamId: string) =>
    api<ScoreSummary>('GET', `/admin/reports/scores${qs({ grade_exam_id: gradeExamId })}`),
  scoreStudents: (gradeExamId: string, classId?: string | null) =>
    api<{ students: ScoreStudentRow[] }>('GET',
      `/admin/reports/scores/students${qs({ grade_exam_id: gradeExamId, class_id: classId })}`),
  exportScoreReport: (gradeExamId: string): Promise<Blob> =>
    download(`/admin/reports/scores/export${qs({ grade_exam_id: gradeExamId })}`),
  attendanceReport: (month: string, gradeId?: string | null) =>
    api<AttendanceReport>('GET', `/admin/reports/attendance${qs({ month, grade_id: gradeId })}`),
  attendanceClass: (month: string, classId: string) =>
    api<AttendanceClassDetail>('GET', `/admin/reports/attendance/class${qs({ month, class_id: classId })}`),
  exportAttendance: (month: string, gradeId?: string | null): Promise<Blob> =>
    download(`/admin/reports/attendance/export${qs({ month, grade_id: gradeId })}`),
  // ---- 审计 ----
  auditActions: () => api<AuditActions>('GET', '/admin/audit/actions'),
  audit: (f: AuditFilters = {}) =>
    api<{ items: AuditRow[]; total: number }>('GET', `/admin/audit${qs({
      from: f.from, to: f.to, user_id: f.user_id, group: f.group, action: f.action,
      object_type: f.object_type, object_id: f.object_id,
      success: f.success === undefined ? undefined : String(f.success), page: f.page,
    })}`),
  // ---- AI ----
  aiUsage: (month: string) => api<AiUsage>('GET', `/admin/ai/usage${qs({ month })}`),
  aiConfig: () => api<AiConfigView>('GET', '/admin/ai/config'),
  saveAiConfig: (b: AiConfigSave) => api<AiConfigView>('PUT', '/admin/ai/config', b),
  clearAiConfig: () => api<void>('DELETE', '/admin/ai/config'),
  testAiConfig: (b: AiConfigSave) =>
    api<{ ok: boolean; message: string }>('POST', '/admin/ai/config/test', b),
  // ---- 通知 ----
  sendNotice: (b: NoticeInput) => api<NoticeSent>('POST', '/admin/notices', b),
  sentNotices: (page: number) =>
    api<{ items: NoticeSent[]; total: number }>('GET', `/admin/notices${qs({ page })}`),
  noticeRecipients: (id: string) =>
    api<NoticeRecipients>('GET', `/admin/notices/${seg(id)}/recipients`),
  recallNotice: (id: string) => api<NoticeSent>('POST', `/admin/notices/${seg(id)}/recall`),
  noticeOptions: () => api<NoticeOptions>('GET', '/admin/notices/options'),
  noticePeople: (q: string) => api<NoticePerson[]>('GET', `/admin/notices/people${qs({ q })}`),
  // ---- 学年升级 ----
  upgradeSuggest: (b: { name: string; start_date: string; end_date: string }) =>
    api<UpgradePlan>('POST', '/admin/years/upgrade/suggest', b),
  upgradePreview: (plan: UpgradePlan) =>
    api<UpgradePreview>('POST', '/admin/years/upgrade/preview', plan),
  upgradeApply: (plan: UpgradePlan) =>
    api<{ upgrade_id: string; new_year_id: string }>('POST', '/admin/years/upgrade', plan),
  upgradeLatest: () => api<UpgradeLatest | null>('GET', '/admin/years/upgrade/latest'),
  upgradeRollback: (upgradeId: string) =>
    api<{ ok: true }>('POST', '/admin/years/upgrade/rollback', { upgrade_id: upgradeId }),
  // ---- 往年班级(只读) ----
  historyYears: () => api<HistoryYear[]>('GET', '/admin/history/years'),
  historyClasses: (yearId: string) =>
    api<HistoryClass[]>('GET', `/admin/history/classes${qs({ year_id: yearId })}`),
  historyStudents: (classId: string) =>
    api<{ students: HistoryStudent[] }>('GET', `/admin/history/classes/${seg(classId)}/students`),
  historyExams: (classId: string) =>
    api<HistoryExam[]>('GET', `/admin/history/classes/${seg(classId)}/exams`),
  historyScores: (examId: string) =>
    api<HistoryScores>('GET', `/admin/history/exams/${seg(examId)}/scores`),
}
