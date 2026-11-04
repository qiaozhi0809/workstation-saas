import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import type { LoginResponse } from '@/shared/types/api'
import { useAuthStore } from '@/shared/stores/auth'
import type { User } from '@/shared/types/user'
import { peekLoginFlash, setLoginFlash } from './flash'
import LoginPage from './LoginPage'

vi.mock('@/shared/api/auth', () => ({ authApi: { login: vi.fn(), logout: vi.fn() } }))

const fill = (login: string, pw: string) => {
  fireEvent.change(screen.getByLabelText('登录名'), { target: { value: login } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: pw } })
  fireEvent.click(screen.getByRole('button', { name: /登录/ }))
}

beforeEach(() => {
  vi.mocked(authApi.login).mockReset()
  vi.mocked(authApi.logout).mockReset().mockResolvedValue({ ok: true })
  useAuthStore.getState().logout()
})

afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('submits trimmed login name and unicode password', async () => {   // Review Focus #5
  vi.mocked(authApi.login).mockResolvedValue({
    access_token: 'a', refresh_token: 'r', expires_at: 'x', user: { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill(' teacher01 ', '中文🎉')
  await waitFor(() => expect(authApi.login).toHaveBeenCalledWith('teacher01', '中文🎉'))
})

it('shows lockout message', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new ApiError(429, 'ACCOUNT_LOCKED', 'locked'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'x')
  expect(await screen.findByText('失败次数过多,请 15 分钟后再试')).toBeInTheDocument()
})

it('shows invalid credentials message', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'bad'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'x')
  expect(await screen.findByRole('alert')).toHaveTextContent('登录名或密码不正确')
})

it('shows invalid credentials message for a 400 BAD_REQUEST', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'bad input'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('   ', 'x')
  expect(await screen.findByRole('alert')).toHaveTextContent('登录名或密码不正确')
})

it('shows generic message for other errors', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new Error('network'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'x')
  expect(await screen.findByRole('alert')).toHaveTextContent('登录失败,请稍后再试')
})

it('stores tokens and navigates to /teacher on success', async () => {
  const user: User = { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false }
  vi.mocked(authApi.login).mockResolvedValue({
    access_token: 'a', refresh_token: 'r', expires_at: 'x', user,
  })
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/teacher" element={<div>teacher home</div>} />
      </Routes>
    </MemoryRouter>,
  )
  fill('teacher01', 'pw')
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  const s = useAuthStore.getState()
  expect(s.accessToken).toBe('a')
  expect(s.refreshToken).toBe('r')
  expect(s.user).toEqual(user)
})

it('disables the button while pending and clears the error on resubmit', async () => {
  vi.mocked(authApi.login).mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'bad'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'x')
  expect(await screen.findByRole('alert')).toBeInTheDocument()

  let resolve!: (v: LoginResponse) => void
  vi.mocked(authApi.login).mockReturnValueOnce(new Promise((r) => { resolve = r }))
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  const btn = await screen.findByRole('button', { name: '登录中…' })
  expect(btn).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  resolve({ access_token: 'a', refresh_token: 'r', expires_at: 'x', user: { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
  await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('a'))
})

it('marks the submit button busy while signing in', async () => {
  vi.mocked(authApi.login).mockReturnValue(new Promise(() => {}))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'dev123')
  const busy = await screen.findByRole('button', { name: '登录中…' })
  expect(busy).toBeDisabled()
  expect(busy).toHaveAttribute('aria-busy', 'true')
})

const loginAs = async (user: Partial<User>, lastContext: 'teacher' | 'admin' | null = null) => {
  useAuthStore.setState({ lastContext })
  vi.mocked(authApi.login).mockResolvedValue({
    access_token: 'a', refresh_token: 'r', expires_at: 'x',
    user: { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false, ...user },
  })
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/teacher" element={<div>teacher home</div>} />
        <Route path="/admin" element={<div>admin home</div>} />
        <Route path="/change-password" element={<div>change pw</div>} />
      </Routes>
    </MemoryRouter>,
  )
  fill('u', 'pw')
}

it('sends a principal to /admin', async () => {
  await loginAs({ contexts: ['admin'], admin_perms: ['school.view'] })
  expect(await screen.findByText('admin home')).toBeInTheDocument()
})

it('sends a teacher to /teacher', async () => {
  await loginAs({ contexts: ['teacher'] })
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
})

it('sends a dual-identity user to the last used context', async () => {
  await loginAs({ contexts: ['teacher', 'admin'] }, 'admin')
  expect(await screen.findByText('admin home')).toBeInTheDocument()
})

it('keeps a must-change-password account without identity on the login page', async () => {
  await loginAs({ contexts: [], must_change_password: true })
  expect(await screen.findByRole('alert')).toHaveTextContent('这个账号还没有分配身份,请联系学校信息中心')
  expect(screen.queryByText('change pw')).toBeNull()
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('sends a user who must change password to /change-password', async () => {
  await loginAs({ must_change_password: true })
  expect(await screen.findByText('change pw')).toBeInTheDocument()
})

it('stays on the login page with a hint when the account has no identity', async () => {
  await loginAs({ contexts: [] })
  expect(await screen.findByRole('alert')).toHaveTextContent('这个账号还没有分配身份,请联系学校信息中心')
  expect(screen.queryByText('teacher home')).toBeNull()
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('revokes the refresh token when discarding a login without identity', async () => {
  await loginAs({ contexts: [] })
  await screen.findByRole('alert')
  expect(authApi.logout).toHaveBeenCalledWith('r')
})

it('shows the one-shot flash once, then clears it', () => {
  setLoginFlash('你的账号已被停用')
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  expect(screen.getByText('你的账号已被停用')).toBeInTheDocument()
  expect(peekLoginFlash()).toBeNull()
})

it('StrictMode 下仍显示提示,之后已清除', () => {
  setLoginFlash('你的账号已被停用')
  render(<StrictMode><MemoryRouter><LoginPage /></MemoryRouter></StrictMode>)
  expect(screen.getByText('你的账号已被停用')).toBeInTheDocument()
  expect(peekLoginFlash()).toBeNull()
})

it('redirects an already signed-in user to the home of the last context', () => {
  const user: User = { id: 'u', display_name: 't', contexts: ['teacher', 'parent'], admin_perms: [], must_change_password: false }
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user, lastContext: 'parent' })
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/parent" element={<div>parent home</div>} />
        <Route path="/teacher" element={<div>teacher home</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('parent home')).toBeInTheDocument()
  expect(screen.queryByLabelText('登录名')).toBeNull()
})

it('redirects a signed-in user who must change the password to /change-password', () => {
  const user: User = { id: 'u', display_name: 't', contexts: ['parent'], admin_perms: [], must_change_password: true }
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user, lastContext: null })
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<div>change pw</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('change pw')).toBeInTheDocument()
})

it('stays on the login form when there is a token but no user yet', () => {
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: null })
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  expect(screen.getByLabelText('登录名')).toBeInTheDocument()
})

it('shows the login form instead of crashing for an old-shape persisted user (no contexts)', () => {
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', display_name: 't' } as unknown as User })
  render(<MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>)
  expect(screen.getByLabelText('登录名')).toBeInTheDocument()
})

it('stays on the login form when the signed-in user has no identity', () => {
  const user: User = { id: 'u', display_name: 't', contexts: [], admin_perms: [], must_change_password: false }
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user, lastContext: null })
  render(<MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>)
  expect(screen.getByLabelText('登录名')).toBeInTheDocument()
})
