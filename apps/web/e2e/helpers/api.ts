import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'

const API = '/api/v1'

export async function login(request: APIRequestContext, loginName: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { login_name: loginName, password: 'dev123' },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { access_token?: string; mfa_required?: true }
  if (body.mfa_required) throw new Error('E2E 账号不应开启两步验证')
  return body.access_token as string
}

/** 把座位存回种子布局:6 × 4,按学号顺序每排 4 人,全部未锁定。 */
export async function restoreSeedSeating(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const summary = await request.get(`${API}/classes/${classId}/classroom`, { headers })
  expect(summary.ok()).toBeTruthy()
  const { seat_version } = (await summary.json()) as { seat_version: number }
  const roster = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(roster.ok()).toBeTruthy()
  const { items } = (await roster.json()) as {
    items: { enrollment_id: string; student_no: string | null }[]
  }
  const seats = [...items]
    .sort((a, b) => (a.student_no ?? '').localeCompare(b.student_no ?? ''))
    .map((s, i) => ({
      enrollment_id: s.enrollment_id,
      row: Math.floor(i / 4) + 1,
      col: (i % 4) + 1,
      locked: false,
    }))
  const saved = await request.put(`${API}/classes/${classId}/seating`, {
    headers,
    data: { base_version: seat_version, rows: 6, cols: 4, seats },
  })
  expect(saved.ok()).toBeTruthy()
}

/** 把桌椅排列存回种子:双人同桌、自己设定 6 排 × 4 座、无讲台座位、教室 求知楼 201,座位随后由 restoreSeedSeating 还原。 */
export async function restoreSeedLayout(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const summary = await request.get(`${API}/classes/${classId}/classroom`, { headers })
  expect(summary.ok()).toBeTruthy()
  const { seat_version } = (await summary.json()) as { seat_version: number }
  const res = await request.put(`${API}/classes/${classId}/layout`, {
    headers,
    data: {
      base_version: seat_version,
      desk_size: 2,
      seat_layout: 'manual',
      rows: 6,
      cols: 4,
      podium_left: 0,
      podium_right: 0,
      how: 'row',
      room: '求知楼 201',
    },
  })
  expect(res.ok()).toBeTruthy()
  await restoreSeedSeating(request, token, classId)
}

/** 经 API 加若干名学生(姓名 测试加人N,不带座位);用例结束由 deleteTestStudents 兜底清理。 */
export async function addTestStudents(
  request: APIRequestContext,
  token: string,
  classId: string,
  count: number,
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const res = await request.post(`${API}/classes/${classId}/students`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `测试加人${i}`,
        gender: null,
        student_no: `20269${String(i).padStart(2, '0')}`,
        birthdate: null,
        class_role: null,
        tags: [],
        boarding: false,
        family_structure: null,
        family_note: null,
        learning_summary: null,
        personality: null,
        note: null,
        health_notes: null,
        contacts: [],
        seat: null,
        auto_seat: true,
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

/** 把 王小一 今天的考勤改回"出勤"(种子初始态);用例失败留下脏状态时也能恢复。 */
export async function restoreSeedAttendance(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<void> {
  const headers = authHeaders(token)
  const summary = await request.get(`${API}/classes/${classId}/classroom`, { headers })
  expect(summary.ok()).toBeTruthy()
  const { today } = (await summary.json()) as { today: string }
  const roster = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(roster.ok()).toBeTruthy()
  const { items } = (await roster.json()) as { items: { enrollment_id: string; name: string }[] }
  const wang = items.find((s) => s.name === '王小一')
  expect(wang).toBeTruthy()
  const res = await request.put(
    `${API}/classes/${classId}/attendance/${today}/${wang!.enrollment_id}`,
    {
      headers,
      data: { status: 'present' },
    },
  )
  expect(res.ok()).toBeTruthy()
}

/** 当前未撤销的点评 op_id 集合,用来在用例前后做差。 */
export async function activeReviewOps(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<Set<string>> {
  const res = await request.get(`${API}/classes/${classId}/reviews?limit=200`, {
    headers: authHeaders(token),
  })
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
    const res = await request.post(`${API}/classes/${classId}/reviews/${op}/revoke`, {
      headers: authHeaders(token),
    })
    expect(res.ok()).toBeTruthy()
  }
}

interface ExamSummary {
  id: string
  name: string
}

/** 删除名字以 E2E 开头的考试(用例自建数据的兜底清理;失败中途退出也不留脏数据)。 */
export async function deleteE2eExams(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<void> {
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
export async function rosterEnrollmentIds(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<string[]> {
  const res = await request.get(`${API}/classes/${classId}/students`, {
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as {
    items: { enrollment_id: string; student_no: string | null }[]
  }
  // 依赖种子学号等长(7 位),文本序即数字序
  return [...items]
    .sort((a, b) => (a.student_no ?? '').localeCompare(b.student_no ?? ''))
    .map((s) => s.enrollment_id)
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
    data: {
      cells: enrollmentIds.map((id, i) => ({ enrollment_id: id, subject, value: scores[i] })),
    },
  })
  expect(res.ok()).toBeTruthy()
}

/** 删除在籍学生里姓名以 测试 开头的人(用例自建学生的兜底清理;失败中途退出也不留脏数据)。 */
export async function deleteTestStudents(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<void> {
  const headers = authHeaders(token)
  const res = await request.get(`${API}/classes/${classId}/students`, { headers })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: { enrollment_id: string; name: string }[] }
  for (const s of items.filter((x) => x.name.startsWith('测试'))) {
    const del = await request.delete(`${API}/classes/${classId}/students/${s.enrollment_id}`, {
      headers,
    })
    expect(del.ok()).toBeTruthy()
  }
}

/** 清空当前账号对某学生的个人笔记(PUT 空文本即删除本人笔记)。 */
export async function clearMyNote(
  request: APIRequestContext,
  token: string,
  studentId: string,
): Promise<void> {
  const res = await request.put(`${API}/students/${studentId}/my-notes`, {
    headers: authHeaders(token),
    data: { text: '' },
  })
  expect(res.ok()).toBeTruthy()
}

/** 在籍学生记录(含 student_id、生日等),按姓名取一人。 */
export async function studentRecord(
  request: APIRequestContext,
  token: string,
  classId: string,
  name: string,
): Promise<{ student_id: string; enrollment_id: string; birthdate: string | null }> {
  const res = await request.get(`${API}/classes/${classId}/students/records`, {
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as {
    items: { name: string; student_id: string; enrollment_id: string; birthdate: string | null }[]
  }
  const found = items.find((s) => s.name === name)
  expect(found).toBeTruthy()
  return found!
}

/** 学校时区的"今天"(来自教室概况)。 */
export async function schoolToday(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<string> {
  const res = await request.get(`${API}/classes/${classId}/classroom`, {
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { today: string }).today
}

/** AI / 档案相关数据的快照:对话、评语、成长记录的 id。用例前取一次,用例后 restoreAiData 删掉新增的。 */
export interface AiDataSnapshot {
  chats: Set<string>
  comments: Set<string>
  growth: Set<string>
}

async function classStudentIds(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<string[]> {
  const res = await request.get(`${API}/classes/${classId}/students`, {
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { items: { student_id: string }[] }).items.map((s) => s.student_id)
}

export async function snapshotAiData(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<AiDataSnapshot> {
  const headers = authHeaders(token)
  const chats = await request.get(`${API}/ai/chats?class_id=${classId}`, { headers })
  expect(chats.ok()).toBeTruthy()
  const snap: AiDataSnapshot = {
    chats: new Set(((await chats.json()) as { items: { id: string }[] }).items.map((c) => c.id)),
    comments: new Set(),
    growth: new Set(),
  }
  for (const sid of await classStudentIds(request, token, classId)) {
    const c = await request.get(`${API}/students/${sid}/comments`, { headers })
    expect(c.ok()).toBeTruthy()
    for (const x of ((await c.json()) as { items: { id: string }[] }).items) snap.comments.add(x.id)
    const g = await request.get(`${API}/students/${sid}/growth-records`, { headers })
    expect(g.ok()).toBeTruthy()
    for (const x of ((await g.json()) as { items: { id: string }[] }).items) snap.growth.add(x.id)
  }
  return snap
}

/** 删掉快照之后新增的对话、评语、成长记录(用班主任 token;对话只能由创建者删,所以要传各创建者的 token)。 */
export async function restoreAiData(
  request: APIRequestContext,
  tokens: string[],
  classId: string,
  snap: AiDataSnapshot,
): Promise<void> {
  // 一条删除失败不能让后面的清理全部跳过:先删完,最后统一断言
  const failed: string[] = []
  const [owner] = tokens
  const ownerHeaders = authHeaders(owner)
  for (const sid of await classStudentIds(request, owner, classId)) {
    const c = await request.get(`${API}/students/${sid}/comments`, { headers: ownerHeaders })
    for (const x of ((await c.json()) as { items: { id: string }[] }).items) {
      if (snap.comments.has(x.id)) continue
      if (!(await request.delete(`${API}/comments/${x.id}`, { headers: ownerHeaders })).ok())
        failed.push(`${API}/comments/${x.id}`)
    }
    const g = await request.get(`${API}/students/${sid}/growth-records`, { headers: ownerHeaders })
    for (const x of ((await g.json()) as { items: { id: string }[] }).items) {
      if (snap.growth.has(x.id)) continue
      if (!(await request.delete(`${API}/growth-records/${x.id}`, { headers: ownerHeaders })).ok())
        failed.push(`${API}/growth-records/${x.id}`)
    }
  }
  // 对话按创建者隔离:每个 token 只看得到、删得掉自己的
  for (const token of tokens) {
    const chats = await request.get(`${API}/ai/chats?class_id=${classId}`, {
      headers: authHeaders(token),
    })
    if (!chats.ok()) continue
    for (const x of ((await chats.json()) as { items: { id: string }[] }).items) {
      if (snap.chats.has(x.id)) continue
      if (!(await request.delete(`${API}/ai/chats/${x.id}`, { headers: authHeaders(token) })).ok())
        failed.push(`${API}/ai/chats/${x.id}`)
    }
  }
  expect(failed, '清理自建数据时有删除失败').toEqual([])
}

/** 给一名学生(enrollment)一条个人点评,返回 op_id。 */
export async function giveReview(
  request: APIRequestContext,
  token: string,
  classId: string,
  enrollmentId: string,
  reason: string,
  delta: number,
): Promise<string> {
  const opId = randomUUID()
  const res = await request.post(`${API}/classes/${classId}/reviews`, {
    headers: authHeaders(token),
    data: {
      op_id: opId,
      category: 'individual',
      enrollment_ids: [enrollmentId],
      reason_text: reason,
      score_delta: delta,
    },
  })
  expect(res.ok()).toBeTruthy()
  return opId
}

/** 某名学生的累计积分(来自点评汇总)。 */
export async function reviewTotal(
  request: APIRequestContext,
  token: string,
  classId: string,
  enrollmentId: string,
): Promise<number> {
  const res = await request.get(`${API}/classes/${classId}/reviews/summary`, {
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  const { items } = (await res.json()) as { items: { enrollment_id: string; total: number }[] }
  return items.find((i) => i.enrollment_id === enrollmentId)?.total ?? 0
}

const adminHeaders = authHeaders

/** 管理端账号的 GET/请求助手:返回响应体,失败直接断言。 */
export async function adminGet<T>(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: adminHeaders(token) })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as T
}

export async function currentUserId(request: APIRequestContext, token: string): Promise<string> {
  return (await adminGet<{ id: string }>(request, token, '/auth/me')).id
}

/** 学校设置里的功能开关(完整对象)。 */
export async function getSwitches(
  request: APIRequestContext,
  token: string,
): Promise<Record<string, boolean>> {
  return adminGet<Record<string, boolean>>(request, token, '/admin/settings/switches')
}

export async function putSwitches(
  request: APIRequestContext,
  token: string,
  value: Record<string, boolean>,
): Promise<void> {
  const res = await request.put(`${API}/admin/settings/switches`, {
    headers: adminHeaders(token),
    data: value,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

/** 结束某用户在某班的全部在任任职(用例自建任职的兜底清理)。 */
export async function endStaffOfUser(
  request: APIRequestContext,
  token: string,
  classId: string,
  userId: string,
): Promise<void> {
  const cls = await adminGet<{
    homeroom: { assignment_id: string; user_id: string } | null
    assistants: { assignment_id: string; user_id: string }[]
    subjects: { teachers: { assignment_id: string; user_id: string }[] }[]
  }>(request, token, `/admin/classes/${classId}`)
  const all = [cls.homeroom, ...cls.assistants, ...cls.subjects.flatMap((s) => s.teachers)].filter(
    (x) => x !== null,
  )
  for (const s of all.filter((x) => x.user_id === userId)) {
    const res = await request.delete(`${API}/admin/staff/${s.assignment_id}`, {
      headers: adminHeaders(token),
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

/** 卸任某用户的全部管理岗位(用例自加的岗位兜底清理)。 */
export async function endRolesOfUser(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<void> {
  const roles = await adminGet<{ binding_id: string; user_id: string }[]>(
    request,
    token,
    '/admin/roles',
  )
  for (const r of roles.filter((x) => x.user_id === userId)) {
    const res = await request.delete(`${API}/admin/roles/${r.binding_id}`, {
      headers: adminHeaders(token),
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

/** 把某场(联考关联的)班级考试里指定科目的分数全部清掉(value:null 即删除这格);考试不存在就什么也不做。 */
export async function clearScores(
  request: APIRequestContext,
  token: string,
  classId: string,
  examName: string,
  subjects: string[],
): Promise<void> {
  const headers = authHeaders(token)
  const list = await request.get(`${API}/classes/${classId}/exams`, { headers })
  expect(list.ok()).toBeTruthy()
  const exam = ((await list.json()) as { items: ExamSummary[] }).items.find(
    (x) => x.name === examName,
  )
  if (!exam) return
  const roster = await rosterEnrollmentIds(request, token, classId)
  const cells = roster.flatMap((id) =>
    subjects.map((subject) => ({ enrollment_id: id, subject, value: null })),
  )
  const res = await request.put(`${API}/classes/${classId}/exams/${exam.id}/scores`, {
    headers,
    data: { cells },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

/** 删除名字以 E2E 开头的年级联考(分数要先用 clearScores 清掉,否则 409)。 */
export async function deleteE2eGradeExams(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const headers = authHeaders(token)
  const res = await request.get(`${API}/admin/grade-exams`, { headers })
  expect(res.ok(), await res.text()).toBeTruthy()
  const items = (await res.json()) as ExamSummary[]
  for (const exam of items.filter((x) => x.name.startsWith('E2E'))) {
    const del = await request.delete(`${API}/admin/grade-exams/${exam.id}`, { headers })
    expect(del.ok(), await del.text()).toBeTruthy()
  }
}

// ---------- M5c:作息 / 课表 / 摄像头(契约见 docs/superpowers/plans/2026-11-05-M5c-监控与课表.md) ----------

/** 学校时区与学校"今天"(来自教室概况):E2E 据此算"现在"落在哪一节。 */
export async function schoolClock(
  request: APIRequestContext,
  token: string,
  classId: string,
): Promise<{ today: string; timezone: string }> {
  return adminGet<{ today: string; timezone: string }>(
    request,
    token,
    `/classes/${classId}/classroom`,
  )
}

export interface PeriodInput {
  no: number
  starts_at: string
  ends_at: string
}

/** 整体替换学校作息(org.manage);被课表引用的节次不能删(409),先清课表。 */
export async function putPeriods(
  request: APIRequestContext,
  token: string,
  periods: PeriodInput[],
): Promise<PeriodInput[]> {
  const res = await request.put(`${API}/admin/periods`, {
    headers: authHeaders(token),
    data: { periods },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as PeriodInput[]
}

export interface TimetableCellInput {
  weekday: number
  period_no: number
  subject: string
  /** 省略 / null:后端按该班该科在任的任课老师自动匹配(唯一时) */
  teacher_id?: string | null
}
export interface TimetableCellOut {
  weekday: number
  period_no: number
  subject: string
  teacher: { id: string; name: string } | null
}
export interface ClassTimetableOut {
  class_id: string
  class_name: string
  cells: TimetableCellOut[]
}

/** 整班替换课表(org.manage),返回保存后的课表。 */
export async function putTimetable(
  request: APIRequestContext,
  token: string,
  classId: string,
  cells: TimetableCellInput[],
): Promise<ClassTimetableOut> {
  const res = await request.put(`${API}/admin/classes/${classId}/timetable`, {
    headers: authHeaders(token),
    data: { cells },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as ClassTimetableOut
}

/** 课表格子原样带回成保存请求体(还原快照用)。 */
export function timetableCellsToInput(cells: TimetableCellOut[]): TimetableCellInput[] {
  return cells.map((c) => ({
    weekday: c.weekday,
    period_no: c.period_no,
    subject: c.subject,
    teacher_id: c.teacher?.id ?? null,
  }))
}

export interface CameraInputBody {
  name: string
  class_id: string | null
  location: '教室' | '走廊' | '操场' | '食堂' | '其他'
  rtsp_url: string
  enabled: boolean
  transcode: boolean
}
export interface CameraRecord {
  id: string
  name: string
  class_id: string | null
  class_name: string | null
  enabled: boolean
  transcode: boolean
  status: 'idle' | 'streaming' | 'error'
  last_error: string | null
}
export interface CameraTestOutcome {
  ok: boolean
  message: string
  preview_jpeg_base64: string | null
  probe: {
    video_codec: string | null
    width: number | null
    height: number | null
    fps: number | null
    bitrate_kbps: number | null
    audio_codec: string | null
    browser_playable: boolean
    hint: string | null
  } | null
}

/** 信息中心 / 校长登记一路摄像头(camera.manage;学校"监控"开关要先打开,否则 404)。 */
export async function createCamera(
  request: APIRequestContext,
  token: string,
  body: CameraInputBody,
): Promise<CameraRecord> {
  const res = await request.post(`${API}/admin/cameras`, {
    headers: authHeaders(token),
    data: body,
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as CameraRecord
}

/** 测试连接:后端把任务交给 stream worker,最多等 10 秒。 */
export async function testCamera(
  request: APIRequestContext,
  token: string,
  cameraId: string,
): Promise<CameraTestOutcome> {
  const res = await request.post(`${API}/admin/cameras/${cameraId}/test`, {
    headers: authHeaders(token),
    timeout: 30_000,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as CameraTestOutcome
}

export async function deleteCamera(
  request: APIRequestContext,
  token: string,
  cameraId: string,
): Promise<void> {
  const res = await request.delete(`${API}/admin/cameras/${cameraId}`, {
    headers: authHeaders(token),
  })
  expect([204, 404]).toContain(res.status())
}

/** 删除名字以 E2E 开头的摄像头(用例自建数据的兜底清理);开关关着时列表 404,当作没有可删的。 */
export async function deleteE2eCameras(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.get(`${API}/admin/cameras`, { headers: authHeaders(token) })
  if (res.status() === 404) return
  expect(res.ok(), await res.text()).toBeTruthy()
  const items = (await res.json()) as CameraRecord[]
  for (const c of items.filter((x) => x.name.startsWith('E2E'))) {
    await deleteCamera(request, token, c.id)
  }
}
