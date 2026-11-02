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

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

/** 把 王小一 今天的考勤改回"出勤"(种子初始态);用例失败留下脏状态时也能恢复。 */
export async function restoreSeedAttendance(request: APIRequestContext, token: string, classId: string): Promise<void> {
  const headers = authHeaders(token)
  const summary = await request.get(`${API}/classes/${classId}/classroom`, { headers })
  expect(summary.ok()).toBeTruthy()
  const { today } = (await summary.json()) as { today: string }
  const roster = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(roster.ok()).toBeTruthy()
  const { items } = (await roster.json()) as { items: { enrollment_id: string; name: string }[] }
  const wang = items.find((s) => s.name === '王小一')
  expect(wang).toBeTruthy()
  const res = await request.put(`${API}/classes/${classId}/attendance/${today}/${wang!.enrollment_id}`, {
    headers,
    data: { status: 'present' },
  })
  expect(res.ok()).toBeTruthy()
}

/** 当前未撤销的点评 op_id 集合,用来在用例前后做差。 */
export async function activeReviewOps(request: APIRequestContext, token: string, classId: string): Promise<Set<string>> {
  const res = await request.get(`${API}/classes/${classId}/reviews?limit=200`, { headers: authHeaders(token) })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: { op_id: string }[] }
  return new Set(items.map((r) => r.op_id))
}

/** 撤销 before 之后新增的点评(自己给的),把点评数据还原到用例开始前。 */
export async function revokeReviewsSince(
  request: APIRequestContext,
  token: string,
  classId: string,
  before: Set<string>,
): Promise<void> {
  for (const op of await activeReviewOps(request, token, classId)) {
    if (before.has(op)) continue
    await request.post(`${API}/classes/${classId}/reviews/${op}/revoke`, { headers: authHeaders(token) })
  }
}
