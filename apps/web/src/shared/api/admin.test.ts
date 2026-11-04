import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { GradeExamInput, NoticeInput, UpgradePlan } from '@/shared/types/admin'
import { adminApi } from './admin'
import { noticesApi } from './notices'
import { ApiError } from './client'
import { authApi } from './auth'
import { schoolApi } from './school'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: { id: 'u', display_name: 'x', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
})

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return {
    method: init.method as string,
    url: url as string,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  }
}

const schoolB = { name: '实验小学', address: null }
const yearB = { name: '2026-2027', start_date: '2026-09-01', end_date: '2027-07-01', term2_start: null }
const gradeB = { name: '三年级', stage: null, display_order: 3 }
const classB = { grade_id: 'g1', name: '二班', room: 'A101' }
const staffB = { user_id: 'u2', identity: 'subject', subject: '数学' } as const
const roleB = { user_id: 'u2', role: 'grade_head', grade_id: 'g1' } as const
const acctI = { display_name: '李四', phone: null, employee_no: null, subjects: ['语文'] }
const sw = {
  parent_rank: false, parent_negative_review: false, teacher_review_frequency: false,
  monitor: false, parent_monitor: false, ai_review_before_send: true, star_of_week: true, birthdays: true,
}

const geB: GradeExamInput = { grade_id: 'g1', name: '期中联考', exam_type: '期中', date: '2026-11-01', subjects: [{ name: '语文', full: 100 }] }
const noticeB: NoticeInput = { title: '开会', content: '明天开会', target: { kind: 'school' } }
const aiB = { provider: 'p', base_url: 'https://x', model: 'm', temperature: 0.5, mask_forced: true, api_key: null }
const planB: UpgradePlan = {
  version: 1, from_year_id: 'y1', new_year: { name: '2027', start_date: '2027-09-01', end_date: '2028-07-01' },
  classes: [], students: [], new_classes: [], grade_heads: null,
}
const upB = { name: '2027', start_date: '2027-09-01', end_date: '2028-07-01' }

const cases: [string, () => Promise<unknown>, string, string, unknown?][] = [
  ['school', () => adminApi.school(), 'GET', '/admin/school'],
  ['saveSchool', () => adminApi.saveSchool(schoolB), 'PUT', '/admin/school', schoolB],
  ['years', () => adminApi.years(), 'GET', '/admin/years'],
  ['saveYear', () => adminApi.saveYear('y1', yearB), 'PUT', '/admin/years/y1', yearB],
  ['grades', () => adminApi.grades(), 'GET', '/admin/grades'],
  ['createGrade', () => adminApi.createGrade(gradeB), 'POST', '/admin/grades', gradeB],
  ['updateGrade', () => adminApi.updateGrade('g1', gradeB), 'PUT', '/admin/grades/g1', gradeB],
  ['deleteGrade', () => adminApi.deleteGrade('g1'), 'DELETE', '/admin/grades/g1'],
  ['classes none', () => adminApi.classes(), 'GET', '/admin/classes'],
  ['classes null', () => adminApi.classes(null), 'GET', '/admin/classes'],
  ['classes grade', () => adminApi.classes('g1'), 'GET', '/admin/classes?grade_id=g1'],
  ['class', () => adminApi.class('c1'), 'GET', '/admin/classes/c1'],
  ['createClass', () => adminApi.createClass(classB), 'POST', '/admin/classes', classB],
  ['updateClass', () => adminApi.updateClass('c1', classB), 'PUT', '/admin/classes/c1', classB],
  ['deleteClass', () => adminApi.deleteClass('c1'), 'DELETE', '/admin/classes/c1'],
  ['addStaff', () => adminApi.addStaff('c1', staffB), 'POST', '/admin/classes/c1/staff', staffB],
  ['endStaff', () => adminApi.endStaff('a1'), 'DELETE', '/admin/staff/a1'],
  ['roles', () => adminApi.roles(), 'GET', '/admin/roles'],
  ['addRole', () => adminApi.addRole(roleB), 'POST', '/admin/roles', roleB],
  ['endRole', () => adminApi.endRole('b1'), 'DELETE', '/admin/roles/b1'],
  ['accounts full', () => adminApi.accounts({ q: '张', role: 'grade_head', status: 'active', page: 2 }), 'GET',
    '/admin/accounts?q=%E5%BC%A0&role=grade_head&status=active&page=2'],
  ['accounts empty', () => adminApi.accounts({ q: '', role: undefined, status: undefined }), 'GET', '/admin/accounts'],
  ['createAccount', () => adminApi.createAccount({ ...acctI, login_name: 'lisi' }), 'POST', '/admin/accounts',
    { ...acctI, login_name: 'lisi' }],
  ['updateAccount', () => adminApi.updateAccount('u2', acctI), 'PUT', '/admin/accounts/u2', acctI],
  ['resetPassword', () => adminApi.resetPassword('u2'), 'POST', '/admin/accounts/u2/reset-password'],
  ['freeze', () => adminApi.freeze('u2'), 'POST', '/admin/accounts/u2/freeze'],
  ['unfreeze', () => adminApi.unfreeze('u2'), 'POST', '/admin/accounts/u2/unfreeze'],
  ['importPreview', () => adminApi.importPreview('a,b'), 'POST', '/admin/accounts/import/preview', { csv: 'a,b' }],
  ['importAccounts', () => adminApi.importAccounts('a,b'), 'POST', '/admin/accounts/import', { csv: 'a,b' }],
  ['saveTagPool', () => adminApi.saveTagPool({ tags: ['住校'], renames: [] }), 'PUT', '/admin/settings/tag-pool',
    { tags: ['住校'], renames: [] }],
  ['switches', () => adminApi.switches(), 'GET', '/admin/settings/switches'],
  ['saveSwitches', () => adminApi.saveSwitches(sw), 'PUT', '/admin/settings/switches', sw],
  ['today', () => adminApi.today(), 'GET', '/admin/today'],
  ['board none', () => adminApi.board(), 'GET', '/admin/board'],
  ['board grade', () => adminApi.board('g1'), 'GET', '/admin/board?grade_id=g1'],
  ['gradeExams none', () => adminApi.gradeExams(), 'GET', '/admin/grade-exams'],
  ['gradeExams grade', () => adminApi.gradeExams('g1'), 'GET', '/admin/grade-exams?grade_id=g1'],
  ['createGradeExam', () => adminApi.createGradeExam(geB), 'POST', '/admin/grade-exams', geB],
  ['updateGradeExam', () => adminApi.updateGradeExam('ge1', geB), 'PUT', '/admin/grade-exams/ge1', geB],
  ['deleteGradeExam', () => adminApi.deleteGradeExam('ge1'), 'DELETE', '/admin/grade-exams/ge1'],
  ['syncGradeExam', () => adminApi.syncGradeExam('ge1'), 'POST', '/admin/grade-exams/ge1/sync'],
  ['scoreReport', () => adminApi.scoreReport('ge1'), 'GET', '/admin/reports/scores?grade_exam_id=ge1'],
  ['scoreStudents all', () => adminApi.scoreStudents('ge1'), 'GET', '/admin/reports/scores/students?grade_exam_id=ge1'],
  ['scoreStudents class', () => adminApi.scoreStudents('ge1', 'c1'), 'GET',
    '/admin/reports/scores/students?grade_exam_id=ge1&class_id=c1'],
  ['attendanceReport month', () => adminApi.attendanceReport('2026-11'), 'GET', '/admin/reports/attendance?month=2026-11'],
  ['attendanceReport grade', () => adminApi.attendanceReport('2026-11', 'g1'), 'GET',
    '/admin/reports/attendance?month=2026-11&grade_id=g1'],
  ['attendanceClass', () => adminApi.attendanceClass('2026-11', 'c1'), 'GET',
    '/admin/reports/attendance/class?month=2026-11&class_id=c1'],
  ['auditActions', () => adminApi.auditActions(), 'GET', '/admin/audit/actions'],
  ['audit empty', () => adminApi.audit({}), 'GET', '/admin/audit'],
  ['audit full', () => adminApi.audit({
    from: '2026-11-01', to: '2026-11-30', user_id: 'u1', group: 'grade', action: 'exam.grade_create',
    object_type: 'grade_exam', object_id: 'ge1', success: false, page: 2,
  }), 'GET', '/admin/audit?from=2026-11-01&to=2026-11-30&user_id=u1&group=grade&action=exam.grade_create&object_type=grade_exam&object_id=ge1&success=false&page=2'],
  ['audit success true', () => adminApi.audit({ success: true }), 'GET', '/admin/audit?success=true'],
  ['aiUsage', () => adminApi.aiUsage('2026-11'), 'GET', '/admin/ai/usage?month=2026-11'],
  ['aiConfig', () => adminApi.aiConfig(), 'GET', '/admin/ai/config'],
  ['saveAiConfig', () => adminApi.saveAiConfig(aiB), 'PUT', '/admin/ai/config', aiB],
  ['clearAiConfig', () => adminApi.clearAiConfig(), 'DELETE', '/admin/ai/config'],
  ['testAiConfig', () => adminApi.testAiConfig(aiB), 'POST', '/admin/ai/config/test', aiB],
  ['sendNotice', () => adminApi.sendNotice(noticeB), 'POST', '/admin/notices', noticeB],
  ['sentNotices', () => adminApi.sentNotices(2), 'GET', '/admin/notices?page=2'],
  ['noticeRecipients', () => adminApi.noticeRecipients('n1'), 'GET', '/admin/notices/n1/recipients'],
  ['recallNotice', () => adminApi.recallNotice('n1'), 'POST', '/admin/notices/n1/recall'],
  ['noticePeople', () => adminApi.noticePeople('张'), 'GET', '/admin/notices/people?q=%E5%BC%A0'],
  ['upgradeSuggest', () => adminApi.upgradeSuggest(upB), 'POST', '/admin/years/upgrade/suggest', upB],
  ['upgradePreview', () => adminApi.upgradePreview(planB), 'POST', '/admin/years/upgrade/preview', planB],
  ['upgradeApply', () => adminApi.upgradeApply(planB), 'POST', '/admin/years/upgrade', planB],
  ['upgradeLatest', () => adminApi.upgradeLatest(), 'GET', '/admin/years/upgrade/latest'],
  ['upgradeRollback', () => adminApi.upgradeRollback('up1'), 'POST', '/admin/years/upgrade/rollback', { upgrade_id: 'up1' }],
  ['historyYears', () => adminApi.historyYears(), 'GET', '/admin/history/years'],
  ['historyClasses', () => adminApi.historyClasses('y0'), 'GET', '/admin/history/classes?year_id=y0'],
  ['historyStudents', () => adminApi.historyStudents('c1'), 'GET', '/admin/history/classes/c1/students'],
  ['historyExams', () => adminApi.historyExams('c1'), 'GET', '/admin/history/classes/c1/exams'],
  ['historyScores', () => adminApi.historyScores('e1'), 'GET', '/admin/history/exams/e1/scores'],
  ['notices inbox', () => noticesApi.inbox(3), 'GET', '/notices?page=3'],
  ['notices read', () => noticesApi.read('n1'), 'POST', '/notices/n1/read'],
  ['notices readAll', () => noticesApi.readAll(), 'POST', '/notices/read-all'],
  ['tagPool', () => schoolApi.tagPool(), 'GET', '/school/tag-pool'],
  ['me', () => authApi.me(), 'GET', '/auth/me'],
  ['changePassword', () => authApi.changePassword({ old_password: 'a', new_password: 'b', refresh_token: 'r' }),
    'POST', '/auth/password', { old_password: 'a', new_password: 'b', refresh_token: 'r' }],
]

it.each(cases)('%s', async (_n, call, method, url, body) => {
  await call()
  const c = lastCall()
  expect(c.method).toBe(method)
  expect(c.url).toBe(`/api/v1${url}`)
  expect(c.body).toEqual(body)
})

it('auth store: setUser 与 lastContext 持久字段', () => {
  const u = { id: 'u9', display_name: 'y', contexts: ['teacher', 'admin'], admin_perms: ['school.view'], must_change_password: false } as const
  useAuthStore.getState().setUser({ ...u, contexts: [...u.contexts], admin_perms: [...u.admin_perms] })
  expect(useAuthStore.getState().user?.id).toBe('u9')
  useAuthStore.getState().setLastContext('admin')
  expect(useAuthStore.getState().lastContext).toBe('admin')
  expect(JSON.parse(localStorage.getItem('ws-auth') ?? '{}').state.lastContext).toBe('admin')
})

it('exportScoreReport: GET 带 Bearer,令牌不进 URL,返回 Blob', async () => {
  fetchMock.mockImplementation(async () => new Response('a,b', { status: 200 }))
  const blob = await adminApi.exportScoreReport('ge1')
  expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')  // jsdom 与 undici 的 Blob 类不同,不能用 instanceof
  expect(await blob.text()).toBe('a,b')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/v1/admin/reports/scores/export?grade_exam_id=ge1')
  expect(init.method).toBe('GET')
  expect(init.headers.Authorization).toBe('Bearer a')
  expect(url).not.toContain('token')
})

it('exportAttendance: 查询串与 Bearer', async () => {
  fetchMock.mockImplementation(async () => new Response('a,b', { status: 200 }))
  const blob = await adminApi.exportAttendance('2026-11', 'g1')
  expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')  // jsdom 与 undici 的 Blob 类不同,不能用 instanceof
  expect(await blob.text()).toBe('a,b')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/v1/admin/reports/attendance/export?month=2026-11&grade_id=g1')
  expect(init.method).toBe('GET')
  expect(init.headers.Authorization).toBe('Bearer a')
  await adminApi.exportAttendance('2026-11')
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/admin/reports/attendance/export?month=2026-11')
})

it('导出方法非 2xx 抛 ApiError', async () => {
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'no' } }), { status: 403 }))
  await expect(adminApi.exportScoreReport('ge1')).rejects.toBeInstanceOf(ApiError)
  await expect(adminApi.exportAttendance('2026-11')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
})
