import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import { summaryFixture } from './Classroom/pageTestUtils'
import TeacherLayout from './TeacherLayout'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/auth', () => ({ authApi: { logout: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))

const cls = (id: string, name: string, role: ClassView['role']): ClassView =>
  ({ id, name, grade_name: '三年级', seat_rows: 6, seat_cols: 4, role })

const renderLayout = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/teacher/classroom']}><TeacherLayout /></MemoryRouter>
  </QueryClientProvider>,
)

function Url() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

const renderAt = (entry: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<TeacherLayout />}>
          <Route path="/teacher/classroom" element={<><div>教室页</div><Url /></>} />
          <Route path="/teacher/scores" element={<><div>成绩页</div><Url /></>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

const openAccount = () => fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture())
  useTeacherStore.setState({ classId: null, unsaved: { seating: false, scores: false } })
  useAuthStore.setState({
    accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', display_name: '王老师' },
  })
})

it('renders a class switcher when the teacher has two classes', async () => {   // Review Focus #4
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [
    cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher'),
  ] })
  renderLayout()
  const select = await screen.findByRole('combobox')
  expect(within(select).getAllByRole('option')).toHaveLength(2)
  expect(useTeacherStore.getState().classId).toBe('a')
})

it('renders plain text when the teacher has one class', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  renderLayout()
  expect(await screen.findByText('三年二班')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('replaces a stale classId that is not among the returned classes', async () => {
  useTeacherStore.setState({ classId: 'zzz' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [
    cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher'),
  ] })
  renderLayout()
  await screen.findByRole('combobox')
  expect(useTeacherStore.getState().classId).toBe('a')
})

it('updates the store when another class is selected', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [
    cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher'),
  ] })
  renderLayout()
  fireEvent.change(await screen.findByRole('combobox', { name: '切换班级' }), { target: { value: 'b' } })
  expect(useTeacherStore.getState().classId).toBe('b')
})

it('asks before switching classes with unsaved seating changes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [
    cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher'),
  ] })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderLayout()
  const select = await screen.findByRole('combobox', { name: '切换班级' })
  useTeacherStore.getState().setUnsaved('seating', true)
  fireEvent.change(select, { target: { value: 'b' } })
  expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
  expect(useTeacherStore.getState().classId).toBe('a')
  expect(select).toHaveValue('a')
  confirmSpy.mockReturnValue(true)
  fireEvent.change(select, { target: { value: 'b' } })
  expect(useTeacherStore.getState().classId).toBe('b')
  confirmSpy.mockRestore()
})

it('shows an error text when classes fail to load', async () => {
  vi.mocked(classesApi.mine).mockRejectedValue(new Error('boom'))
  renderLayout()
  expect(await screen.findByText('班级加载失败')).toBeInTheDocument()
})

it('logs out: calls the API, clears state and lands on /login', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  vi.mocked(authApi.logout).mockResolvedValue({ ok: true })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/teacher/classroom']}>
        <Routes>
          <Route path="/teacher/classroom" element={<TeacherLayout />} />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('三年二班')
  openAccount()
  expect(within(screen.getByRole('menu', { name: '账号菜单' })).getByText('王老师')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(authApi.logout).toHaveBeenCalledWith('rt')
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
  expect(useTeacherStore.getState().classId).toBeNull()
  expect(await screen.findByText('登录页')).toBeInTheDocument()
})

it('asks before logging out with unsaved seating changes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderLayout()
  await screen.findByText('三年二班')
  useTeacherStore.getState().setUnsaved('seating', true)
  openAccount()
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
  expect(authApi.logout).not.toHaveBeenCalled()
  expect(useAuthStore.getState().refreshToken).toBe('rt')
  confirmSpy.mockReturnValue(true)
  openAccount()
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(authApi.logout).toHaveBeenCalledWith('rt')
  confirmSpy.mockRestore()
})

it('asks before switching classes or logging out with unsaved scores', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [
    cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher'),
  ] })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderLayout()
  const select = await screen.findByRole('combobox', { name: '切换班级' })
  useTeacherStore.getState().setUnsaved('scores', true)
  fireEvent.change(select, { target: { value: 'b' } })
  expect(confirmSpy).toHaveBeenCalledWith('还有成绩没保存,确定离开?')
  expect(useTeacherStore.getState().classId).toBe('a')
  openAccount()
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(confirmSpy).toHaveBeenCalledTimes(2)
  expect(authApi.logout).not.toHaveBeenCalled()
  expect(useAuthStore.getState().refreshToken).toBe('rt')
  confirmSpy.mockReturnValue(true)
  fireEvent.change(select, { target: { value: 'b' } })
  expect(useTeacherStore.getState().classId).toBe('b')
  confirmSpy.mockRestore()
})

it('shows the main navigation with the current page marked', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  renderAt('/teacher/scores')
  const nav = await screen.findByRole('navigation', { name: '主导航' })
  expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
    '/teacher/classroom', '/teacher/scores', '/teacher/analysis', '/teacher/students',
  ])
  expect(within(nav).getByRole('link', { name: '成绩' })).toHaveAttribute('aria-current', 'page')
  for (const name of ['教室', '分析', '学生']) {
    expect(within(nav).getByRole('link', { name })).not.toHaveAttribute('aria-current')
  }
})

it('opens the profile drawer from ?student= on any teacher page and closes back to the same page', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  vi.mocked(studentsApi.detail).mockResolvedValue({ id: 's1', enrollment_id: 'e1', mk: 'S0001', name: '王小一', class_id: 'a' })
  renderAt('/teacher/scores?student=s1')
  expect(await screen.findByRole('dialog', { name: '王小一' })).toBeInTheDocument()
  expect(studentsApi.detail).toHaveBeenCalledWith('s1')
  expect(screen.getByText('成绩页')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/scores$/)
})

it('resets the drawer tab when switching to another student', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  vi.mocked(studentsApi.detail).mockImplementation(async (id: string) =>
    ({ id, enrollment_id: 'e' + id, mk: 'M' + id, name: id === 's1' ? '王小一' : '李小二', class_id: 'a' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/teacher/classroom?student=s1']}>
        <Routes>
          <Route element={<TeacherLayout />}>
            <Route path="/teacher/classroom" element={<Link to="/teacher/classroom?student=s2">去二号</Link>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByRole('dialog', { name: '王小一' })
  fireEvent.click(screen.getByRole('tab', { name: '档案' }))
  expect(screen.getByRole('tab', { name: '档案' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByText('去二号'))
  await screen.findByRole('dialog', { name: '李小二' })
  expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true')
})

it('links to my preferences', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  renderLayout()
  await screen.findByText('三年二班')
  openAccount()
  expect(screen.getByRole('menuitem', { name: '我的偏好' })).toHaveAttribute('href', '/teacher/preferences')
})

it('shows grade, school year and week next to the class name', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  renderLayout()
  const f = summaryFixture()
  expect(await screen.findByText(`三年级 · ${f.year.name} 第 ${f.week_no} 周`)).toBeInTheDocument()
})

it('keeps 我的偏好 and 退出登录 in the account menu under my initial', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls('a', '三年二班', 'homeroom_teacher')] })
  renderLayout()
  const trigger = await screen.findByRole('button', { name: '账号菜单' })
  expect(trigger).toHaveTextContent('王')
  expect(trigger).toHaveAttribute('title', '王老师')
  expect(screen.queryByRole('button', { name: '退出登录' })).toBeNull()
  openAccount()
  const menu = screen.getByRole('menu', { name: '账号菜单' })
  expect(within(menu).getByText('王老师')).toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: '我的偏好' })).toHaveAttribute('href', '/teacher/preferences')
  expect(within(menu).getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()
})
