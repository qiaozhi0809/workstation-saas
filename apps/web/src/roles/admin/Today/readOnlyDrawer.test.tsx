import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { attendanceApi } from '@/shared/api/attendance'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { commentsApi } from '@/shared/api/comments'
import { examsApi } from '@/shared/api/exams'
import { growthApi } from '@/shared/api/growth'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import type { TodayView } from '@/shared/types/admin'
import TodayPage from './TodayPage'
import ClassViewPage from '../Board/ClassViewPage'
import { boardClassApi } from '../Board/api'
import { boardClass } from '../Board/boardFixtures'
import { Route, Routes } from 'react-router-dom'

// 真实的档案抽屉,只 mock 数据接口:领导身份的 my_perms 只含读权限
vi.mock('@/shared/api/admin', () => ({ adminApi: { today: vi.fn() } }))
vi.mock('../Board/api', () => ({ boardClassApi: { detail: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))
vi.mock('@/shared/api/attendance', () => ({ attendanceApi: { month: vi.fn() } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn() } }))
vi.mock('@/shared/api/comments', () => ({ commentsApi: { list: vi.fn() } }))
vi.mock('@/shared/api/growth', () => ({ growthApi: { list: vi.fn() } }))
vi.mock('@/shared/api/reviews', () => ({
  reviewsApi: { summary: vi.fn(), listForStudent: vi.fn() },
}))

const today: TodayView = {
  date: '2026-10-14',
  scope_label: '全校',
  totals: {
    students: 1,
    present: 1,
    leave: 0,
    absent: 0,
    late: 0,
    classes: 1,
    confirmed_classes: 1,
  },
  absentees: [],
  unconfirmed: [],
  week_reviews: { classes: [], bottom: [], teachers: [] },
}

const WRITE_BUTTON =
  /编辑|保存|添加|删除|撤销|AI|点评|加分|扣分|生成|家长沟通|职务|记成长|排座|考勤/

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.today).mockResolvedValue(today)
  vi.mocked(boardClassApi.detail).mockResolvedValue({ ...boardClass(), absentees: [] })
  vi.mocked(classroomApi.summary).mockResolvedValue({
    today: '2026-10-14',
    timezone: 'Asia/Shanghai',
    week_no: 6,
    school_name: '示例小学',
    week_start: '2026-10-12',
    year: { id: 'y', name: '2026-2027', start_date: '2026-09-01', end_date: '2027-07-15' },
    seat_version: 1,
    my_perms: ['attendance.read', 'review.read', 'exam.read', 'growth.read', 'comment.read'],
    my_subjects: [],
    board: {
      left_title: '',
      left_text: '',
      right_title: '',
      right_text: '',
      countdown_label: null,
      countdown_date: null,
    },
  })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [] })
  vi.mocked(studentsApi.detail).mockResolvedValue({
    id: 's1',
    enrollment_id: 'e1',
    mk: 'S0001',
    name: '王小一',
    class_id: 'c1',
    gender: '男',
    contacts: [{ name: '王大一', relation: '父亲', phone: '13800000001', job: '' }],
  })
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-10', items: [] })
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [] })
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [] })
  vi.mocked(growthApi.list).mockResolvedValue({ items: [] })
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-10-12', items: [] })
  vi.mocked(reviewsApi.listForStudent).mockResolvedValue({ items: [], next_cursor: null })
})
afterEach(cleanup)

async function expectNoWriteEntries() {
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('group', { name: '概况指标' })
  for (const tab of ['概览', '档案', '成绩', '成长记录', '评语']) {
    fireEvent.click(within(drawer).getByRole('tab', { name: tab }))
    await within(drawer).findByRole('tabpanel', { name: tab })
    // 等该页签的数据都回来(加载态消失)
    await vi.waitFor(() => expect(within(drawer).queryByRole('status')).toBeNull())
    const names = within(drawer)
      .queryAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
    expect(
      names.filter((n) => WRITE_BUTTON.test(n)),
      `${tab} 页签`,
    ).toEqual([])
    expect(within(drawer).queryAllByRole('textbox'), `${tab} 页签没有输入框`).toEqual([])
  }
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('领导身份的档案抽屉是只读的', () => {
  it('今日关注页:各页签都没有写入口', async () => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/admin/today?student=s1']}>
          <TodayPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await expectNoWriteEntries()
  })

  it('单班页:各页签都没有写入口', async () => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/admin/classes/c1?student=s1']}>
          <Routes>
            <Route path="/admin/classes/:id" element={<ClassViewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await expectNoWriteEntries()
  })
})
