import { expect, type APIRequestContext } from '@playwright/test'

const API = '/api/v1'

export async function login(request: APIRequestContext, loginName: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { login_name: loginName, password: 'dev123' } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { access_token: string }).access_token
}

/** 把座位存回种子布局:6 × 4,按学号顺序每排 4 人,全部未锁定。 */
export async function restoreSeedSeating(request: APIRequestContext, token: string, classId: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const summary = await request.get(`${API}/classes/${classId}/classroom`, { headers })
  expect(summary.ok()).toBeTruthy()
  const { seat_version } = (await summary.json()) as { seat_version: number }
  const roster = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(roster.ok()).toBeTruthy()
  const { items } = (await roster.json()) as { items: { enrollment_id: string; student_no: string | null }[] }
  const seats = [...items]
    .sort((a, b) => (a.student_no ?? '').localeCompare(b.student_no ?? ''))
    .map((s, i) => ({ enrollment_id: s.enrollment_id, row: Math.floor(i / 4) + 1, col: (i % 4) + 1, locked: false }))
  const saved = await request.put(`${API}/classes/${classId}/seating`, {
    headers,
    data: { base_version: seat_version, rows: 6, cols: 4, seats },
  })
  expect(saved.ok()).toBeTruthy()
}
