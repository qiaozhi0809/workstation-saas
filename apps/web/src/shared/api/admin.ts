import type {
  Account, AccountCreate, AccountInput, AccountPage, AdminRole, AdminRoleInput, BoardView,
  ClassAdmin, ClassInput, GradeAdmin, GradeInput, ImportRow, SchoolInfo, StaffInput, Switches,
  TagPool, TagPoolSave, TodayView, YearAdmin, YearUpdate,
} from '@/shared/types/admin'
import { api } from './client'

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
}
