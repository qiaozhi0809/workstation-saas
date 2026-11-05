import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { orgApi } from './orgApi'
import { ApiError } from '@/shared/api/client'
import type { AdminRole, ClassAdmin, GradeAdmin, YearAdmin } from '@/shared/types/admin'
import OrgPage from './OrgPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    school: vi.fn(),
    saveSchool: vi.fn(),
    years: vi.fn(),
    saveYear: vi.fn(),
    grades: vi.fn(),
    createGrade: vi.fn(),
    updateGrade: vi.fn(),
    deleteGrade: vi.fn(),
    classes: vi.fn(),
    createClass: vi.fn(),
    deleteClass: vi.fn(),
    roles: vi.fn(),
    addRole: vi.fn(),
    endRole: vi.fn(),
  },
}))
vi.mock('./orgApi', () => ({ orgApi: { people: vi.fn() } }))
const api = vi.mocked(adminApi)
const org = vi.mocked(orgApi)

const year: YearAdmin = {
  id: 'y1',
  name: '2026-2027学年',
  start_date: '2026-09-01',
  end_date: '2027-07-10',
  term2_start: '2027-02-20',
  is_active: true,
}
const grade = (id: string, name: string, order: number, n = 1): GradeAdmin => ({
  id,
  name,
  stage: null,
  effective_stage: '小学',
  display_order: order,
  class_count: n,
})
const cls: ClassAdmin = {
  id: 'c1',
  name: '三年二班',
  grade_id: 'g3',
  grade_name: '三年级',
  room: '301',
  student_count: 40,
  homeroom: { assignment_id: 'a1', user_id: 'u1', display_name: '李老师' },
  assistants: [],
  subjects: [],
  desk_size: 2,
  seat_layout: 'auto',
  seat_rows: 6,
  seat_cols: 8,
  podium_left: 0,
  podium_right: 0,
}
const itRole: AdminRole = {
  binding_id: 'b1',
  user_id: 'u9',
  display_name: '周信息',
  role: 'it_admin',
  grade_id: null,
  grade_name: null,
}

let grades: GradeAdmin[]

beforeEach(() => {
  grades = [grade('g3', '三年级', 3)]
  api.school.mockResolvedValue({ name: '示范小学', address: null })
  api.years.mockResolvedValue([year])
  api.grades.mockImplementation(() => Promise.resolve(grades))
  api.classes.mockResolvedValue([cls])
  api.roles.mockResolvedValue([itRole])
  org.people.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <OrgPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

it('blocks a term-2 date earlier than the start date', async () => {
  renderPage()
  const input = await screen.findByLabelText('第二学期开学日期')
  fireEvent.change(input, { target: { value: '2026-08-01' } })
  fireEvent.click(screen.getByRole('button', { name: '保存学年' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('第二学期开学日期')
  expect(api.saveYear).not.toHaveBeenCalled()
  expect(screen.getByText('开学日期决定教室顶栏的第几周')).toBeInTheDocument()
})

it('refreshes the grade list after creating a grade', async () => {
  api.createGrade.mockImplementation(async (b) => {
    grades = [...grades, { ...grade('g4', b.name, b.display_order, 0) }]
    return grades[grades.length - 1]
  })
  renderPage()
  await screen.findByText('三年级')
  fireEvent.click(screen.getByRole('button', { name: '新建年级' }))
  fireEvent.change(screen.getByLabelText('年级名称'), { target: { value: '四年级' } })
  fireEvent.click(screen.getByRole('button', { name: '创建' }))
  expect(await screen.findByText('四年级')).toBeInTheDocument()
  expect(api.createGrade).toHaveBeenCalledWith({ name: '四年级', stage: null, display_order: 4 })
})

it('shows the backend message when deleting a grade that still has classes', async () => {
  api.deleteGrade.mockRejectedValue(new ApiError(409, 'GRADE_NOT_EMPTY', '年级下还有班级,不能删除'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '删除年级 三年级' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  expect(await screen.findByText('年级下还有班级,不能删除')).toBeInTheDocument()
})

it('shows the backend message when ending the last it admin', async () => {
  api.endRole.mockRejectedValue(new ApiError(409, 'LAST_ADMIN', '至少要保留一位能管账号的信息中心'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '卸任 周信息' }))
  fireEvent.click(screen.getByRole('button', { name: '确认卸任' }))
  expect(await screen.findByText('至少要保留一位能管账号的信息中心')).toBeInTheDocument()
  await waitFor(() => expect(api.endRole).toHaveBeenCalledWith('b1'))
})

it('moves a grade by swapping display_order', async () => {
  grades = [grade('g3', '三年级', 3), grade('g4', '四年级', 4)]
  api.updateGrade.mockResolvedValue(grades[0])
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '上移 四年级' }))
  await waitFor(() => expect(api.updateGrade).toHaveBeenCalledTimes(2))
  expect(api.updateGrade).toHaveBeenCalledWith('g4', {
    name: '四年级',
    stage: null,
    display_order: 0,
  })
  expect(api.updateGrade).toHaveBeenCalledWith('g3', {
    name: '三年级',
    stage: null,
    display_order: 1,
  })
})

it('renumbers grades sharing a display_order so the swap yields distinct orders', async () => {
  grades = [grade('g3', '三年级', 1), grade('g4', '四年级', 1), grade('g5', '五年级', 5)]
  api.updateGrade.mockResolvedValue(grades[0])
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '上移 四年级' }))
  await waitFor(() => expect(api.updateGrade).toHaveBeenCalledTimes(2))
  const orders = Object.fromEntries(
    api.updateGrade.mock.calls.map(([id, b]) => [id, b.display_order]),
  )
  // g3 已是 1,无需再发;最终 g4=0、g3=1、g5=2 互不相同
  expect(orders).toEqual({ g4: 0, g5: 2 })
})

it('does not send a PUT for grades whose order is unchanged', async () => {
  grades = [grade('g0', '一年级', 0), grade('g1', '二年级', 1), grade('g2', '三年级', 2)]
  api.updateGrade.mockResolvedValue(grades[0])
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '上移 三年级' }))
  await waitFor(() => expect(api.updateGrade).toHaveBeenCalledTimes(2))
  expect(api.updateGrade).not.toHaveBeenCalledWith('g0', expect.anything())
})

it('falls back to the first grade when the selected grade is deleted', async () => {
  grades = [grade('g3', '三年级', 3), grade('g4', '四年级', 4)]
  api.deleteGrade.mockImplementation(async (id) => {
    grades = grades.filter((g) => g.id !== id)
  })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /^四年级/ }))
  await waitFor(() => expect(api.classes).toHaveBeenCalledWith('g4'))
  fireEvent.click(screen.getByRole('button', { name: '删除年级 四年级' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(screen.queryByText('四年级')).toBeNull())
  await waitFor(() => expect(api.classes).toHaveBeenLastCalledWith('g3'))
  expect(screen.getByRole('button', { name: /^三年级/ })).toHaveAttribute('aria-pressed', 'true')
})

it.each([
  ['school', '学校信息加载失败'],
  ['years', '学年加载失败'],
  ['roles', '管理岗位加载失败'],
  ['grades', '年级加载失败'],
] as const)('shows an error state when %s fails to load', async (key, title) => {
  api[key].mockRejectedValue(new ApiError(500, 'X', '服务器开小差了'))
  renderPage()
  expect(await screen.findByText(title)).toBeInTheDocument()
})

it('wraps the class table in an overflow-x-auto container', async () => {
  renderPage()
  const table = await screen.findByRole('table')
  expect(table.closest('.overflow-x-auto')).not.toBeNull()
  expect(within(table).getByText('三年二班')).toBeInTheDocument()
})
