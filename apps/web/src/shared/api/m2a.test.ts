import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { attendanceApi } from './attendance'
import { classroomApi } from './classroom'
import { newOpId } from './opId'
import { preferencesApi } from './preferences'
import { reviewsApi } from './reviews'
import { seatingApi } from './seating'
import { studentsApi } from './students'
import { todosApi } from './todos'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', display_name: 'x', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
})

const calls: [string, () => Promise<unknown>, string, string, unknown][] = [
  ['summary', () => classroomApi.summary('c1'), 'GET', '/api/v1/classes/c1/classroom', undefined],
  ['board', () => classroomApi.saveBoard('c1', { left_title: 'a', left_text: '', right_title: 'b',
    right_text: '', countdown_label: null, countdown_date: null }), 'PUT', '/api/v1/classes/c1/board',
    { left_title: 'a', left_text: '', right_title: 'b', right_text: '', countdown_label: null,
      countdown_date: null }],
  ['day', () => attendanceApi.day('c1', '2026-11-02'), 'GET',
    '/api/v1/classes/c1/attendance?date=2026-11-02', undefined],
  ['set', () => attendanceApi.set('c1', '2026-11-02', 'e1', { status: 'leave' }), 'PUT',
    '/api/v1/classes/c1/attendance/2026-11-02/e1', { status: 'leave' }],
  ['confirm', () => attendanceApi.confirm('c1', '2026-11-02', true), 'POST',
    '/api/v1/classes/c1/attendance/2026-11-02/confirm', { clear_exceptions: true }],
  ['month', () => attendanceApi.month('c1', '2026-11'), 'GET',
    '/api/v1/classes/c1/attendance/month?month=2026-11', undefined],
  ['list', () => reviewsApi.list('c1', { cursor: 'x=', limit: 6 }), 'GET',
    '/api/v1/classes/c1/reviews?cursor=x%3D&limit=6', undefined],
  ['rsum', () => reviewsApi.summary('c1'), 'GET', '/api/v1/classes/c1/reviews/summary', undefined],
  ['revoke', () => reviewsApi.revoke('c1', 'op'), 'POST', '/api/v1/classes/c1/reviews/op/revoke', undefined],
  ['seat', () => seatingApi.save('c1', { base_version: 0, rows: 6, cols: 4, seats: [] }), 'PUT',
    '/api/v1/classes/c1/seating', { base_version: 0, rows: 6, cols: 4, seats: [] }],
  ['todo', () => todosApi.update('t1', { done: true }), 'PATCH', '/api/v1/me/todos/t1', { done: true }],
  ['prefs', () => preferencesApi.get(), 'GET', '/api/v1/me/preferences', undefined],
  ['role', () => studentsApi.setClassRole('c1', 'e1', '班长'), 'PUT',
    '/api/v1/classes/c1/students/e1/class-role', { class_role: '班长' }],
]

it.each(calls)('%s calls the frozen endpoint', async (_n, call, method, url, body) => {
  await call()
  const [gotUrl, init] = fetchMock.mock.calls[0]
  expect(gotUrl).toBe(url)
  expect(init.method).toBe(method)
  expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body)
})

it('creates distinct op ids', () => {
  expect(newOpId()).toMatch(/^[0-9a-f-]{36}$/)
  expect(newOpId()).not.toBe(newOpId())
})

it('builds RFC 4122 v4 op ids without crypto.randomUUID (plain-HTTP intranet)', () => {
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  try {
    const ids = Array.from({ length: 50 }, () => newOpId())
    for (const id of ids) expect(id).toMatch(v4)
    expect(new Set(ids).size).toBe(ids.length)
  } finally { vi.unstubAllGlobals() }
})
