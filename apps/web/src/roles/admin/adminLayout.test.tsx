import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom'
import { Building2, Users } from 'lucide-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { noticesApi } from '@/shared/api/notices'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent'
import { useAuthStore } from '@/shared/stores/auth'
import type { Context } from '@/shared/types/admin'
import AdminHome from './AdminHome'
import AdminLayout from './AdminLayout'
import type { AdminPage } from './pages'
import { DRAFT_KEY } from './Upgrade/useUpgradeDraft'

vi.mock('@/shared/api/admin', () => ({ adminApi: { school: vi.fn() } }))
vi.mock('@/shared/api/auth', () => ({ authApi: { logout: vi.fn(async () => undefined) } }))
vi.mock('@/shared/api/notices', () => ({
  noticesApi: { inbox: vi.fn(), read: vi.fn(), readAll: vi.fn() },
}))

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

const pages: AdminPage[] = [
  {
    path: 'org',
    label: '组织架构',
    icon: Building2,
    perm: 'org.manage',
    element: <div>org page</div>,
  },
  {
    path: 'accounts',
    label: '账号',
    icon: Users,
    perm: 'account.manage',
    element: <div>accounts page</div>,
  },
]

const setUser = (
  contexts: Context[],
  admin_perms: ('account.manage' | 'org.manage')[],
  lastContext: Context | null = null,
) =>
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    lastContext,
    user: {
      id: 'u',
      display_name: '张主任',
      contexts,
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })

const renderAt = (entry: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute context="admin">
                <AdminLayout pages={pages} />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminHome pages={pages} />} />
            {pages.map((p) => (
              <Route key={p.path} path={p.path} element={p.element} />
            ))}
          </Route>
          <Route path="/teacher" element={<div>teacher home</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.made.length = 0
  vi.mocked(noticesApi.inbox).mockResolvedValue({ items: [], total: 0, unread: 1 })
  vi.mocked(adminApi.school).mockResolvedValue({ name: '虚构实验学校', address: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('lists only the pages the user may use and lands on the first of them', async () => {
  setUser(['admin'], ['account.manage'])
  renderAt('/admin')
  expect(await screen.findByText('accounts page')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(
    within(nav)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href')),
  ).toEqual(['/admin/accounts'])
})

it('shows the school name for an org.manage admin', async () => {
  setUser(['admin'], ['org.manage'])
  renderAt('/admin')
  expect(await screen.findByText('虚构实验学校')).toBeInTheDocument()
})

it('shows an empty state when no page is available', () => {
  setUser(['admin'], [])
  renderAt('/admin')
  expect(screen.getByText('你的账号还没有可用的管理功能')).toBeInTheDocument()
})

it('sends a teacher away from /admin', () => {
  setUser(['teacher'], [])
  renderAt('/admin')
  expect(screen.getByText('teacher home')).toBeInTheDocument()
})

it('shows the school name for an admin without org.manage', async () => {
  setUser(['admin'], ['account.manage'])
  renderAt('/admin')
  await screen.findByText('accounts page')
  expect(await screen.findByText('虚构实验学校')).toBeInTheDocument()
  expect(adminApi.school).toHaveBeenCalled()
})

it('hides the school name when it fails to load', async () => {
  vi.mocked(adminApi.school).mockRejectedValue(new Error('x'))
  setUser(['admin'], ['org.manage'])
  renderAt('/admin')
  await screen.findByText('org page')
  expect(screen.queryByText('虚构实验学校')).toBeNull()
})

it('switches to the teacher side and remembers it', async () => {
  setUser(['admin', 'teacher'], ['org.manage'])
  renderAt('/admin')
  await screen.findByText('org page')
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '切换到教师端' }))
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  expect(useAuthStore.getState().lastContext).toBe('teacher')
})

// L54(审查裁定):只有这里的"退出登录"主动清升级向导草稿;会话过期等被动登出不清
it('explicit logout drops the upgrade wizard draft and goes to the login page', async () => {
  setUser(['admin'], ['org.manage'])
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({ v: 2, owner: 'u', step: 'year', year: {}, plan: null, ui: {} }),
  )
  renderAt('/admin')
  await screen.findByText('org page')
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
  expect(await screen.findByText('login page')).toBeInTheDocument()
  expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
})

// 缺口 B-1:RealtimeProvider 必须真的挂在管理壳里,布局内的订阅者才收得到事件
function Probe() {
  const [seen, setSeen] = useState<string[]>([])
  useRealtimeEvent('notice.new', (e) => setSeen((s) => [...s, e.title]))
  return <div data-testid="probe">{seen.join('|')}</div>
}

const renderRouted = (entry: string) => {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: (
          <ProtectedRoute context="admin">
            <AdminLayout pages={pages} />
          </ProtectedRoute>
        ),
        children: [{ path: 'org', element: <Probe /> }],
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
}

it('delivers realtime events to the bell and to subscribers inside the admin shell', async () => {
  setUser(['admin'], ['org.manage'])
  renderRouted('/admin/org')
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

it('stops the realtime client when the admin shell unmounts', async () => {
  setUser(['admin'], ['org.manage'])
  renderRouted('/admin/org')
  await screen.findByRole('button', { name: '通知,1 条未读' })
  cleanup()
  expect(h.made[0].start).toHaveBeenCalledTimes(1)
  expect(h.made[0].stop).toHaveBeenCalled()
})

it('opens no realtime connection on /change-password', async () => {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: '张主任',
      contexts: ['admin'],
      admin_perms: ['org.manage'],
      must_change_password: true,
      password_change_reason: null,
    },
  })
  renderRouted('/admin/org')
  expect(await screen.findByText('改密码页')).toBeInTheDocument()
  await waitFor(() => expect(h.made).toHaveLength(0))
  expect(noticesApi.inbox).not.toHaveBeenCalled()
})

it('puts the notice bell before the theme toggle in the sidebar footer', async () => {
  setUser(['admin'], ['org.manage'])
  renderAt('/admin')
  const bell = await screen.findByRole('button', { name: '通知,1 条未读' })
  const theme = screen.getByRole('button', { name: /^主题:/ })
  expect(bell.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('shows the breadcrumb for the current page above the content', async () => {
  setUser(['admin'], ['org.manage'])
  renderAt('/admin/org')
  const crumbs = await screen.findByRole('navigation', { name: '面包屑' })
  expect(within(crumbs).getByText('组织架构')).toHaveAttribute('aria-current', 'page')
})

it('keeps the brand, bell, theme and account menu in the sidebar, not a top bar', async () => {
  setUser(['admin'], ['org.manage'])
  renderAt('/admin/org')
  const side = await screen.findByRole('complementary', { name: '侧栏' })
  expect(within(side).getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  expect(await within(side).findByText('虚构实验学校')).toBeInTheDocument()
  expect(within(side).getByRole('button', { name: /^通知/ })).toHaveClass('touch-target')
  expect(within(side).getByRole('button', { name: /^主题:/ })).toHaveClass('touch-target')
  expect(within(side).getByRole('button', { name: '账号菜单' })).toHaveClass('touch-target')
  expect(screen.queryByRole('banner')).toBeNull()
})

it('marks the current page in the sidebar and keeps the skip link', async () => {
  setUser(['admin'], ['org.manage', 'account.manage'])
  renderAt('/admin/accounts')
  const nav = await screen.findByRole('navigation', { name: '主导航' })
  expect(within(nav).getByRole('link', { name: '账号' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: '跳到主要内容' })).toBeInTheDocument()
})
