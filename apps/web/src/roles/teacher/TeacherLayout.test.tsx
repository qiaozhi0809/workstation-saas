import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Link,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  useLocation,
} from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { noticesApi } from '@/shared/api/notices'
import { preferencesApi } from '@/shared/api/preferences'
import { studentsApi } from '@/shared/api/students'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import { preferencesFixture, summaryFixture } from './Classroom/pageTestUtils'
import TeacherLayout from './TeacherLayout'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/auth', () => ({ authApi: { logout: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))
vi.mock('@/shared/api/notices', () => ({
  noticesApi: { inbox: vi.fn(), read: vi.fn(), readAll: vi.fn() },
}))
// 壳里挂了欢迎页:默认当作已引导过,不弹
vi.mock('@/shared/api/preferences', () => ({ preferencesApi: { get: vi.fn(), save: vi.fn() } }))

const h = vi.hoisted(() => ({
  made: [] as { opts: { onEvent(e: unknown): void }; start: () => void; stop: () => void }[],
}))
vi.mock('@/shared/realtime/client', async (orig) => ({
  ...(await orig<typeof import('@/shared/realtime/client')>()),
  createRealtimeClient: (opts: { onEvent(e: unknown): void }) => {
    const c = { opts, start: vi.fn(), stop: vi.fn() }
    h.made.push(c)
    return c
  },
}))

const cls = (id: string, name: string, role: ClassView['role']): ClassView => ({
  id,
  name,
  grade_name: '三年级',
  seat_rows: 6,
  seat_cols: 4,
  desk_size: 2,
  seat_layout: 'manual',
  seat_order: 'row',
  podium_left: 0,
  podium_right: 0,
  room: '',
  role,
})

const renderLayout = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/teacher/classroom']}>
        <TeacherLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  )

function Url() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

const renderAt = (entry: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<TeacherLayout />}>
            <Route
              path="/teacher/classroom"
              element={
                <>
                  <div>教室页</div>
                  <Url />
                </>
              }
            />
            <Route
              path="/teacher/scores"
              element={
                <>
                  <div>成绩页</div>
                  <Url />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

const openAccount = () => fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))

beforeEach(() => {
  vi.clearAllMocks()
  h.made.length = 0
  vi.mocked(noticesApi.inbox).mockResolvedValue({ items: [], total: 0, unread: 1 })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture())
  vi.mocked(preferencesApi.get).mockResolvedValue({
    ...preferencesFixture,
    onboarded: { teacher: '2026-11-01T01:00:00Z' },
  })
  useTeacherStore.setState({ classId: null, unsaved: { seating: false, scores: false } })
  // 教室页的侧栏默认是 rail;下面大多数用例看的是展开态,先把教室页 scope 记成"展开"
  localStorage.clear()
  localStorage.setItem('ws-sidebar:classroom', '0')
  useAuthStore.setState({
    accessToken: 'at',
    refreshToken: 'rt',
    user: {
      id: 'u1',
      display_name: '王老师',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})

it('renders a class switcher when the teacher has two classes', async () => {
  // Review Focus #4
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
  })
  renderLayout()
  const select = await screen.findByRole('combobox')
  expect(within(select).getAllByRole('option')).toHaveLength(2)
  expect(useTeacherStore.getState().classId).toBe('a')
})

// L40:切换班级的下拉按班名自然排序(三年二班 < 三年三班 < 三年十班),年级保持后端给的顺序,默认班是排在最前的那个
it('orders the class switcher by natural class name within each grade', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [
      cls('ten', '三年十班', 'subject_teacher'),
      cls('two', '三年二班', 'subject_teacher'),
      { ...cls('four-one', '四年一班', 'subject_teacher'), grade_name: '四年级' },
      cls('three', '三年三班', 'homeroom_teacher'),
    ],
  })
  renderLayout()
  const select = await screen.findByRole('combobox', { name: '切换班级' })
  expect(
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['三年二班', '三年三班', '三年十班', '四年一班'])
  expect(useTeacherStore.getState().classId).toBe('two')
})

it('renders plain text when the teacher has one class', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  expect(await screen.findByText('三年二班')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('replaces a stale classId that is not among the returned classes', async () => {
  useTeacherStore.setState({ classId: 'zzz' })
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
  })
  renderLayout()
  await screen.findByRole('combobox')
  expect(useTeacherStore.getState().classId).toBe('a')
})

it('updates the store when another class is selected', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
  })
  renderLayout()
  fireEvent.change(await screen.findByRole('combobox', { name: '切换班级' }), {
    target: { value: 'b' },
  })
  expect(useTeacherStore.getState().classId).toBe('b')
})

it('asks before switching classes with unsaved seating changes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
  })
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
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  vi.mocked(authApi.logout).mockResolvedValue({ ok: true })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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
  expect(
    within(screen.getByRole('menu', { name: '账号菜单' })).getByText('王老师'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(authApi.logout).toHaveBeenCalledWith('rt')
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
  expect(useTeacherStore.getState().classId).toBeNull()
  expect(await screen.findByText('登录页')).toBeInTheDocument()
})

it('asks before logging out with unsaved seating changes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
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
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
  })
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
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderAt('/teacher/scores')
  const nav = await screen.findByRole('navigation', { name: '主导航' })
  expect(
    within(nav)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href')),
  ).toEqual([
    '/teacher/classroom',
    '/teacher/scores',
    '/teacher/analysis',
    '/teacher/students',
    '/teacher/ai',
  ])
  expect(within(nav).getByRole('link', { name: '成绩' })).toHaveAttribute('aria-current', 'page')
  for (const name of ['教室', '分析', '学生', 'AI 助手']) {
    expect(within(nav).getByRole('link', { name })).not.toHaveAttribute('aria-current')
  }
})

it('opens the profile drawer from ?student= on any teacher page and closes back to the same page', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  vi.mocked(studentsApi.detail).mockResolvedValue({
    id: 's1',
    enrollment_id: 'e1',
    mk: 'S0001',
    name: '王小一',
    class_id: 'a',
  })
  renderAt('/teacher/scores?student=s1')
  expect(await screen.findByRole('dialog', { name: '王小一' })).toBeInTheDocument()
  expect(studentsApi.detail).toHaveBeenCalledWith('s1')
  expect(screen.getByText('成绩页')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/scores$/)
})

it('resets the drawer tab when switching to another student', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  vi.mocked(studentsApi.detail).mockImplementation(async (id: string) => ({
    id,
    enrollment_id: 'e' + id,
    mk: 'M' + id,
    name: id === 's1' ? '王小一' : '李小二',
    class_id: 'a',
  }))
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/teacher/classroom?student=s1']}>
        <Routes>
          <Route element={<TeacherLayout />}>
            <Route
              path="/teacher/classroom"
              element={<Link to="/teacher/classroom?student=s2">去二号</Link>}
            />
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
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  await screen.findByText('三年二班')
  openAccount()
  expect(screen.getByRole('menuitem', { name: '我的偏好' })).toHaveAttribute(
    'href',
    '/teacher/preferences',
  )
})

it('shows grade, school year and week next to the class name', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  const f = summaryFixture()
  expect(await screen.findByText(`三年级 · ${f.year.name} 第 ${f.week_no} 周`)).toBeInTheDocument()
})

it('keeps 我的偏好 and 退出登录 in the account menu under my initial', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  const trigger = await screen.findByRole('button', { name: '账号菜单' })
  expect(trigger).toHaveTextContent('王')
  expect(trigger).toHaveAttribute('title', '王老师')
  expect(screen.queryByRole('button', { name: '退出登录' })).toBeNull()
  openAccount()
  const menu = screen.getByRole('menu', { name: '账号菜单' })
  expect(within(menu).getByText('王老师')).toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: '我的偏好' })).toHaveAttribute(
    'href',
    '/teacher/preferences',
  )
  expect(within(menu).getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()
})

it('shows the room after the grade, and no stray separators without a room', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [{ ...cls('a', '三年二班', 'homeroom_teacher'), room: '求知楼 201' }],
  })
  const first = renderLayout()
  expect(await screen.findByText('三年级 · 求知楼 201 · 2026-2027 第 10 周')).toBeInTheDocument()
  first.unmount()
  useTeacherStore.setState({ classId: null })
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  expect(await screen.findByText('三年级 · 2026-2027 第 10 周')).toBeInTheDocument()
})

it('offers 切换到管理端 only to dual-identity users', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  const first = renderLayout()
  await screen.findByText('三年二班')
  openAccount()
  expect(screen.queryByRole('menuitem', { name: '切换到管理端' })).toBeNull()
  first.unmount()
  useAuthStore.setState({
    user: {
      id: 'u1',
      display_name: '王老师',
      contexts: ['teacher', 'admin'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
  renderLayout()
  await screen.findByText('三年二班')
  openAccount()
  expect(screen.getByRole('menuitem', { name: '切换到管理端' })).toBeInTheDocument()
})

afterEach(cleanup)

// 缺口 B-1:RealtimeProvider 必须真的挂在壳里,布局内的订阅者才收得到事件
function Probe() {
  const [seen, setSeen] = useState<string[]>([])
  useRealtimeEvent('notice.new', (e) => setSeen((s) => [...s, e.title]))
  return <div data-testid="probe">{seen.join('|')}</div>
}

const renderRouted = (
  entry: string,
  user = {
    id: 'u1',
    display_name: '王老师',
    contexts: ['teacher'] as const,
    admin_perms: [],
    must_change_password: false,
    password_change_reason: null,
  },
) => {
  useAuthStore.setState({ user: { ...user, contexts: [...user.contexts] } })
  const router = createMemoryRouter(
    [
      {
        path: '/teacher',
        element: (
          <ProtectedRoute context="teacher">
            <TeacherLayout />
          </ProtectedRoute>
        ),
        children: [{ path: 'classroom', element: <Probe /> }],
      },
      { path: '/change-password', element: <div>改密码页</div> },
    ],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

it('delivers realtime events to the bell and to subscribers inside the teacher shell', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderRouted('/teacher/classroom')
  expect(await screen.findByRole('button', { name: '通知,1 条未读' })).toBeInTheDocument()
  expect(h.made).toHaveLength(1)
  vi.mocked(noticesApi.inbox).mockResolvedValue({ items: [], total: 0, unread: 2 })
  await act(async () => {
    h.made[0].opts.onEvent({
      type: 'notice.new',
      id: 'n1',
      title: '周五放假',
      from_name: '陈校长',
      created_at: '2026-11-04T01:00:00Z',
    })
  })
  expect(screen.getByTestId('probe')).toHaveTextContent('周五放假')
  expect(await screen.findByRole('button', { name: '通知,2 条未读' })).toBeInTheDocument()
  expect(screen.getByText('新通知:周五放假')).toBeInTheDocument()
})

it('stops the realtime client when the teacher shell unmounts', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderRouted('/teacher/classroom')
  await screen.findByRole('button', { name: '通知,1 条未读' })
  cleanup()
  expect(h.made[0].start).toHaveBeenCalledTimes(1)
  expect(h.made[0].stop).toHaveBeenCalled()
})

it('opens no realtime connection on /change-password', async () => {
  renderRouted('/teacher/classroom', {
    id: 'u1',
    display_name: '王老师',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: true,
    password_change_reason: null,
  })
  expect(await screen.findByText('改密码页')).toBeInTheDocument()
  await waitFor(() => expect(h.made).toHaveLength(0))
  expect(noticesApi.inbox).not.toHaveBeenCalled()
})

it('puts the notice bell before the theme toggle in the sidebar footer', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  renderLayout()
  const bell = await screen.findByRole('button', { name: '通知,1 条未读' })
  const theme = screen.getByRole('button', { name: /^主题:/ })
  expect(bell.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('mounts the welcome dialog only for a teacher who has not been onboarded', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  const first = renderLayout()
  await screen.findByText('三年二班')
  await waitFor(() => expect(preferencesApi.get).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()
  first.unmount()
  useTeacherStore.setState({ classId: null })
  vi.mocked(preferencesApi.get).mockResolvedValue({ ...preferencesFixture, onboarded: {} })
  renderLayout()
  expect(await screen.findByRole('dialog', { name: '你好,王老师' })).toBeInTheDocument()
})

it('passes the current class my_perms to the nav: 班级公告 only with class.notice', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  const first = renderAt('/teacher/classroom')
  await screen.findByText('教室页')
  await screen.findByText('三年级 · 2026-2027 第 10 周')
  expect(screen.queryByRole('link', { name: '班级公告' })).toBeNull()
  first.unmount()
  useTeacherStore.setState({ classId: null })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['class.notice'] }))
  renderAt('/teacher/classroom')
  expect(await screen.findByRole('link', { name: '班级公告' })).toHaveAttribute(
    'href',
    '/teacher/notices',
  )
})

// ---- 侧栏(M6 S-4)----
const TWO_CLASSES = () => ({
  items: [cls('a', '三年二班', 'homeroom_teacher'), cls('b', '三年三班', 'subject_teacher')],
})

it('classroom route uses classroom scope and no breadcrumb', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
  localStorage.clear() // 没有任何记录:教室页从 rail 开始
  renderLayout()
  const expand = await screen.findByRole('button', { name: '展开侧栏' })
  expect(screen.queryByRole('navigation', { name: '面包屑' })).toBeNull()
  fireEvent.click(expand)
  expect(localStorage.getItem('ws-sidebar:classroom')).toBe('0')
  expect(localStorage.getItem('ws-sidebar')).toBeNull()
})

it('other teacher pages show a breadcrumb and use the default scope', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
  localStorage.clear()
  renderAt('/teacher/scores')
  const crumbs = await screen.findByRole('navigation', { name: '面包屑' })
  expect(within(crumbs).getByText('成绩')).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: '折叠侧栏' }))
  expect(localStorage.getItem('ws-sidebar')).toBe('1')
  // 非教室页只写默认 scope,不碰教室页的记录(上面 clear() 之后它本来就没有)
  expect(localStorage.getItem('ws-sidebar:classroom')).toBeNull()
})

describe('classroom below 1280', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a drawer with the class name and week line in the top bar', async () => {
    vi.stubGlobal('matchMedia', (q: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0)
      return {
        matches: 1024 >= min,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }
    })
    vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
    renderLayout()
    expect(await screen.findByText(/三年二班/)).toBeInTheDocument()
    expect(await screen.findByText(/三年级 · 2026-2027 第 10 周/)).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
    // 抽屉里切班仍走 confirmLeave
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    useTeacherStore.getState().setUnsaved('seating', true)
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '切换班级' }), {
      target: { value: 'b' },
    })
    expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
    expect(useTeacherStore.getState().classId).toBe('a')
    confirmSpy.mockRestore()
  })
})

describe('rail', () => {
  beforeEach(() => localStorage.setItem('ws-sidebar:classroom', '1'))

  it('switching class from the rail asks confirmLeave', async () => {
    vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderLayout()
    await waitFor(() => expect(useTeacherStore.getState().classId).toBe('a'))
    useTeacherStore.getState().setUnsaved('seating', true)
    fireEvent.click(await screen.findByRole('button', { name: /切换班级/ }))
    const menu = screen.getByRole('menu', { name: '切换班级' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '三年三班' }))
    expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
    expect(useTeacherStore.getState().classId).toBe('a')
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /切换班级/ }))
    fireEvent.click(
      within(screen.getByRole('menu', { name: '切换班级' })).getByRole('menuitem', {
        name: '三年三班',
      }),
    )
    expect(useTeacherStore.getState().classId).toBe('b')
    confirmSpy.mockRestore()
  })

  it('rail shows week under class button', async () => {
    vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
    renderLayout()
    const f = summaryFixture()
    expect(await screen.findByText(`${f.week_no} 周`)).toBeInTheDocument()
    // 班名不整行显示,只有首字按钮;完整班名在按钮的名称里
    expect(screen.getByRole('button', { name: /切换班级.*三年二班/ })).toHaveTextContent('三')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('rail class menu carries the grade, room and week line and the hover hint', async () => {
    vi.mocked(classesApi.mine).mockResolvedValue({
      items: [
        { ...cls('a', '三年二班', 'homeroom_teacher'), room: '求知楼 201' },
        cls('b', '三年三班', 'subject_teacher'),
      ],
    })
    renderLayout()
    const trigger = await screen.findByRole('button', { name: /切换班级/ })
    await screen.findByText('10 周')
    expect(trigger).toHaveAttribute('title', '三年二班 · 三年级 · 求知楼 201 · 2026-2027 第 10 周')
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: '切换班级' })
    // 说明行不是菜单项,点不了
    expect(within(menu).getByText('三年级 · 求知楼 201 · 2026-2027 第 10 周')).toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
  })

  it('a single class still gets a menu in the rail, with the info line and one item', async () => {
    vi.mocked(classesApi.mine).mockResolvedValue({
      items: [cls('a', '三年二班', 'homeroom_teacher')],
    })
    renderLayout()
    const trigger = await screen.findByRole('button', { name: '当前班级,三年二班' })
    expect(trigger).toHaveTextContent('三')
    await screen.findByText('10 周')
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: '班级信息' })
    expect(within(menu).getByText('三年级 · 2026-2027 第 10 周')).toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
  })

  it('shows a short failure mark when classes fail to load', async () => {
    vi.mocked(classesApi.mine).mockRejectedValue(new Error('boom'))
    renderLayout()
    expect(await screen.findByText('班级加载失败')).toBeInTheDocument()
  })

  it('keeps the account menu inside the rail without the chevron', async () => {
    vi.mocked(classesApi.mine).mockResolvedValue(TWO_CLASSES())
    renderLayout()
    const trigger = await screen.findByRole('button', { name: '账号菜单' })
    expect(trigger.querySelector('svg')).toBeNull()
  })
})

it('[ does not toggle while profile drawer input is focused', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [cls('a', '三年二班', 'homeroom_teacher')],
  })
  vi.mocked(studentsApi.detail).mockResolvedValue({
    id: 's1',
    enrollment_id: 'e1',
    mk: 'S0001',
    name: '王小一',
    class_id: 'a',
  })
  renderAt('/teacher/scores?student=s1')
  const dialog = await screen.findByRole('dialog', { name: '王小一' })
  const input = document.createElement('input')
  input.setAttribute('aria-label', '抽屉备注')
  dialog.appendChild(input)
  input.focus()
  fireEvent.keyDown(input, { key: '[' })
  expect(localStorage.getItem('ws-sidebar')).toBeNull()
  expect(screen.getByRole('button', { name: '折叠侧栏', hidden: true })).toBeInTheDocument()
})
