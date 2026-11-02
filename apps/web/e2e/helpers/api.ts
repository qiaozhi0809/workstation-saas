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
    const res = await request.post(`${API}/classes/${classId}/reviews/${op}/revoke`, { headers: authHeaders(token) })
    expect(res.ok()).toBeTruthy()
  }
}

interface ExamSummary { id: string; name: string }

/** 删除名字以 E2E 开头的考试(用例自建数据的兜底清理;失败中途退出也不留脏数据)。 */
export async function deleteE2eExams(request: APIRequestContext, token: string, classId: string): Promise<void> {
  const headers = authHeaders(token)
  const res = await request.get(`${API}/classes/${classId}/exams`, { headers })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: ExamSummary[] }
  for (const exam of items.filter((x) => x.name.startsWith('E2E'))) {
    const del = await request.delete(`${API}/classes/${classId}/exams/${exam.id}`, { headers })
    expect(del.ok()).toBeTruthy()
  }
}

/** 用 API 建一场考试(科目只用小学预设里已有的),返回考试 id。 */
export async function createExam(
  request: APIRequestContext,
  token: string,
  classId: string,
  exam: { name: string; date: string; subjects: { name: string; full: number }[] },
): Promise<string> {
  const res = await request.post(`${API}/classes/${classId}/exams`, {
    headers: authHeaders(token),
    data: { ...exam, exam_type: '月考' },
  })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

/** 在籍学生按学号排序的 enrollment_id(与种子座位顺序一致,第 0 位是 王小一)。 */
export async function rosterEnrollmentIds(request: APIRequestContext, token: string, classId: string): Promise<string[]> {
  const res = await request.get(`${API}/classes/${classId}/students`, { headers: authHeaders(token) })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: { enrollment_id: string; student_no: string | null }[] }
  // 依赖种子学号等长(7 位),文本序即数字序
  return [...items].sort((a, b) => (a.student_no ?? '').localeCompare(b.student_no ?? '')).map((s) => s.enrollment_id)
}

/** 给一场考试的单科批量写分数:scores[i] 对应 enrollmentIds[i]。 */
export async function putScores(
  request: APIRequestContext,
  token: string,
  classId: string,
  examId: string,
  subject: string,
  enrollmentIds: string[],
  scores: number[],
): Promise<void> {
  const res = await request.put(`${API}/classes/${classId}/exams/${examId}/scores`, {
    headers: authHeaders(token),
    data: { cells: enrollmentIds.map((id, i) => ({ enrollment_id: id, subject, value: scores[i] })) },
  })
  expect(res.ok()).toBeTruthy()
}

/** 删除在籍学生里姓名以 测试 开头的人(用例自建学生的兜底清理;失败中途退出也不留脏数据)。 */
export async function deleteTestStudents(request: APIRequestContext, token: string, classId: string): Promise<void> {
  const headers = authHeaders(token)
  const res = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: { enrollment_id: string; name: string }[] }
  for (const s of items.filter((x) => x.name.startsWith('测试'))) {
    const del = await request.delete(`${API}/classes/${classId}/students/${s.enrollment_id}`, { headers })
    expect(del.ok()).toBeTruthy()
  }
}

/** 清空当前账号对某学生的个人笔记(PUT 空文本即删除本人笔记)。 */
export async function clearMyNote(request: APIRequestContext, token: string, studentId: string): Promise<void> {
  const res = await request.put(`${API}/students/${studentId}/my-notes`, { headers: authHeaders(token), data: { text: '' } })
  expect(res.ok()).toBeTruthy()
}

/** 在籍学生记录(含 student_id、生日等),按姓名取一人。 */
export async function studentRecord(
  request: APIRequestContext,
  token: string,
  classId: string,
  name: string,
): Promise<{ student_id: string; enrollment_id: string; birthdate: string | null }> {
  const res = await request.get(`${API}/classes/${classId}/students/records`, { headers: authHeaders(token) })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as {
    items: { name: string; student_id: string; enrollment_id: string; birthdate: string | null }[]
  }
  const found = items.find((s) => s.name === name)
  expect(found).toBeTruthy()
  return found!
}

/** 学校时区的"今天"(来自教室概况)。 */
export async function schoolToday(request: APIRequestContext, token: string, classId: string): Promise<string> {
  const res = await request.get(`${API}/classes/${classId}/classroom`, { headers: authHeaders(token) })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { today: string }).today
}
