/* eslint-disable react-refresh/only-export-components -- 测试辅助模块,不参与热更新 */
// 教室页测试的共用夹具与渲染辅助(只给 *.test.tsx 用)。
// vi.mock 按测试文件提升,所以每个页面测试文件自己写下面 8 行(自动 mock,函数全部变成 vi.fn()):
//   vi.mock('@/shared/api/classes'); vi.mock('@/shared/api/students'); vi.mock('@/shared/api/classroom')
//   vi.mock('@/shared/api/attendance'); vi.mock('@/shared/api/reviews'); vi.mock('@/shared/api/seating')
//   vi.mock('@/shared/api/todos'); vi.mock('@/shared/api/preferences')
// 然后在 beforeEach 里 `vi.resetAllMocks(); defaultApiMocks()`,用例里按需覆盖某个 mock 后再 setup()。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { preferencesApi } from '@/shared/api/preferences'
import { reviewsApi } from '@/shared/api/reviews'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import { todosApi } from '@/shared/api/todos'
import { Toaster } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm, ClassroomSummary } from '@/shared/types/classroom'
import type { Preferences } from '@/shared/types/preferences'
import type { Review, ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'
import ClassroomPage from './ClassroomPage'
import type { ClassroomUiMode } from './ModeBar'

export const ALL_PERMS: ClassPerm[] = [
  'attendance.read', 'attendance.write', 'review.read', 'review.write',
  'seating.write', 'board.write', 'student.write_basic',
]

export const classFixture: ClassView = {
  id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 3, seat_cols: 4, role: 'homeroom_teacher',
}

const student = (n: number, name: string, col: number, gender: string, birthdate: string): StudentSeat => ({
  enrollment_id: `e${n}`, student_id: `s${n}`, name, mk: `S000${n}`, seat_row: 1, seat_col: col,
  avatar_seed: null, gender, student_no: `202600${n}`, birthdate, class_role: null, seat_locked: false,
})

export const rosterFixture: StudentSeat[] = [
  student(1, '王小一', 1, '男', '2017-11-03'),
  student(2, '李小二', 2, '女', '2017-11-01'),
  student(3, '张小三', 3, '男', '2016-02-29'),
]

export function summaryFixture(over: Partial<ClassroomSummary> = {}): ClassroomSummary {
  return {
    today: '2026-11-02',
    timezone: 'Asia/Shanghai',
    week_no: 10,
    week_start: '2026-11-02',
    year: { id: 'y1', name: '2026-2027', start_date: '2026-09-01', end_date: '2027-07-15' },
    seat_version: 4,
    my_perms: ALL_PERMS,
    my_subjects: [],
    board: {
      left_title: '今日课程', left_text: '', right_title: '今日事项', right_text: '',
      countdown_label: null, countdown_date: null,
    },
    ...over,
  }
}

export function review(over: Partial<Review> = {}): Review {
  return {
    id: 'r1', op_id: 'op1', enrollment_id: 'e1', category: 'individual',
    reason_text: '积极发言', score_delta: 1, subject: null,
    given_at: '2026-11-02T01:00:00Z', given_by_me: true,
    student_name: '王小一', transferred: false,
    ...over,
  }
}

export const preferencesFixture: Preferences = {
  teacher_figure: 'female',
  idle_animation: true,
  review_reasons: [
    { text: '积极发言', delta: 1 }, { text: '作业优秀', delta: 1 }, { text: '乐于助人', delta: 1 },
    { text: '值日认真', delta: 1 }, { text: '考试进步', delta: 2 }, { text: '为班争光', delta: 3 },
    { text: '上课走神', delta: -1 }, { text: '作业未交', delta: -1 }, { text: '迟到', delta: -1 },
    { text: '违反纪律', delta: -2 },
  ],
}

export const reviewSummaryFixture: ReviewSummary = {
  week_start: '2026-11-02',
  items: rosterFixture.map((s) => ({ enrollment_id: s.enrollment_id, total: 0, week: 0, plus_count: 0, minus_count: 0 })),
}

/** 给 8 个 API 模块的每个函数设好默认返回值(写操作回显请求)。 */
export function defaultApiMocks() {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })

  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
  vi.mocked(studentsApi.detail).mockResolvedValue({
    id: 's1', enrollment_id: 'e1', mk: 'S0001', name: '王小一', class_id: 'c1',
  })
  vi.mocked(studentsApi.setClassRole).mockImplementation(async (_c, enrollment_id, class_role) => ({ enrollment_id, class_role }))

  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture())
  vi.mocked(classroomApi.saveBoard).mockImplementation(async (_c, board) => board)

  vi.mocked(attendanceApi.day).mockImplementation(async (_c, date) => ({ date, confirmed_at: null, items: [] }))
  vi.mocked(attendanceApi.set).mockImplementation(async (_c, _d, enrollment_id, body) =>
    ({ enrollment_id, status: body.status, reason: body.reason ?? null }))
  vi.mocked(attendanceApi.confirm).mockImplementation(async (_c, date) =>
    ({ date, confirmed_at: '2026-11-02T01:00:00Z', items: [] }))
  vi.mocked(attendanceApi.month).mockImplementation(async (_c, month) => ({ month, items: [] }))

  vi.mocked(reviewsApi.list).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(reviewsApi.summary).mockResolvedValue(reviewSummaryFixture)
  vi.mocked(reviewsApi.create).mockImplementation(async (_c, body) => ({
    items: (body.enrollment_ids ?? rosterFixture.map((s) => s.enrollment_id)).map((enrollment_id, i) => review({
      id: `${body.op_id}-${i}`, op_id: body.op_id, enrollment_id, category: body.category,
      reason_text: body.reason_text, score_delta: body.score_delta, subject: body.subject ?? null,
    })),
  }))
  vi.mocked(reviewsApi.revoke).mockImplementation(async (_c, op_id) => ({ op_id, revoked: 1 }))

  vi.mocked(seatingApi.save).mockImplementation(async (_c, body) =>
    ({ version: body.base_version + 1, rows: body.rows, cols: body.cols }))

  vi.mocked(todosApi.list).mockResolvedValue({ items: [] })
  vi.mocked(todosApi.create).mockImplementation(async (content) =>
    ({ id: 't1', content, done: false, created_at: '2026-11-02T01:00:00Z' }))
  vi.mocked(todosApi.update).mockImplementation(async (id, patch) =>
    ({ id, content: patch.content ?? '', done: patch.done ?? false, created_at: '2026-11-02T01:00:00Z' }))
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)

  vi.mocked(preferencesApi.get).mockResolvedValue(preferencesFixture)
  vi.mocked(preferencesApi.save).mockImplementation(async (prefs) => prefs)
}

const MODE_OF: Record<'日常' | '考勤' | '点评' | '排座', ClassroomUiMode> = {
  日常: 'daily', 考勤: 'attendance', 点评: 'review', 排座: 'seating',
}

export interface SetupOptions {
  /** 页面打开时所在的模式(等同于点了对应标签;同步生效,首次出现座位时已是该模式)。 */
  mode?: keyof typeof MODE_OF
  /** 覆盖 summary 的 my_perms(默认班主任全部 7 项)。 */
  perms?: ClassPerm[]
  /** 覆盖 summary 的 my_subjects(默认 [])。 */
  subjects?: string[]
  /** 覆盖名单(默认 rosterFixture)。 */
  roster?: StudentSeat[]
  /** 教师端当前班级(默认 'c1';M1 用例用 null / 失效 id 测加载态)。 */
  classId?: string | null
}

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

/** 渲染教室页(QueryClient 关重试 + 内存 data router + Toaster),返回 render 结果、QueryClient 与 router。 */
export function setup({ mode, perms, subjects, roster, classId = 'c1' }: SetupOptions = {}) {
  if (roster) vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster })
  if (perms || subjects) {
    vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({
      ...(perms ? { my_perms: perms } : {}),
      ...(subjects ? { my_subjects: subjects } : {}),
    }))
  }
  act(() => {
    useTeacherStore.setState({ classId })
    useAuthStore.setState({ user: { id: 'u1', display_name: '王老师' } })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = mode && mode !== '日常' ? MODE_OF[mode] : null
  const entry = ui ? `/teacher/classroom?mode=${ui}` : '/teacher/classroom'
  // data router:页面里的 useBlocker 只能在它下面用
  const router = createMemoryRouter([
    { path: '/teacher/classroom', element: <ClassroomPage /> },
    { path: '/teacher/students/:id', element: <Loc /> },
    { path: '/teacher/preferences', element: <Loc /> },
  ], { initialEntries: [entry] })
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return { ...result, client, router }
}
