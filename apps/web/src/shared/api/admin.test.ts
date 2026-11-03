import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { adminApi } from './admin'
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
})
