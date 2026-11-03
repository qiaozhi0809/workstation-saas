import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Building2, Users } from 'lucide-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useAuthStore } from '@/shared/stores/auth'
import type { Context } from '@/shared/types/admin'
import AdminHome from './AdminHome'
import AdminLayout from './AdminLayout'
import type { AdminPage } from './pages'

vi.mock('@/shared/api/admin', () => ({ adminApi: { school: vi.fn() } }))

const pages: AdminPage[] = [
  { path: 'org', label: '组织架构', icon: Building2, perm: 'org.manage', element: <div>org page</div> },
  { path: 'accounts', label: '账号', icon: Users, perm: 'account.manage', element: <div>accounts page</div> },
]

const setUser = (contexts: Context[], admin_perms: ('account.manage' | 'org.manage')[], lastContext: Context | null = null) =>
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r', lastContext,
    user: { id: 'u', display_name: '张主任', contexts, admin_perms, must_change_password: false },
  })

const renderAt = (entry: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<ProtectedRoute context="admin"><AdminLayout pages={pages} /></ProtectedRoute>}>
          <Route index element={<AdminHome pages={pages} />} />
          {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
        </Route>
        <Route path="/teacher" element={<div>teacher home</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.school).mockResolvedValue({ name: '虚构实验学校', address: null })
})
afterEach(() => { cleanup(); useAuthStore.getState().logout() })

it('lists only the pages the user may use and lands on the first of them', async () => {
  setUser(['admin'], ['account.manage'])
  renderAt('/admin')
  expect(await screen.findByText('accounts page')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/admin/accounts'])
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

it('hides the school name when it fails to load', async () => {
  vi.mocked(adminApi.school).mockRejectedValue(new Error('x'))
  setUser(['admin'], ['org.manage'])
  renderAt('/admin')
  await screen.findByText('org page')
  expect(screen.queryByText('虚构实验学校')).toBeNull()
})
