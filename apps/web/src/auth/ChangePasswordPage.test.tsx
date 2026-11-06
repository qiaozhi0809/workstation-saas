import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import ChangePasswordPage from './ChangePasswordPage'

vi.mock('@/shared/api/auth', () => ({
  authApi: { changePassword: vi.fn(), me: vi.fn(), passwordPolicy: vi.fn() },
}))

const user = {
  id: 'u',
  display_name: 't',
  contexts: ['teacher' as const],
  admin_perms: [],
  must_change_password: true,
  password_change_reason: 'first_login' as const,
}

const fill = (oldPw: string, newPw: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: oldPw } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPw } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/teacher" element={<div>teacher home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 8, max_age_days: 0 })
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'rt', user, lastContext: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('shows the heading and the rule hint', async () => {
  renderPage()
  expect(screen.getByRole('heading', { name: '首次登录请先修改密码' })).toBeInTheDocument()
  expect(await screen.findByText('至少 8 位,字母、数字、符号中至少两种')).toBeInTheDocument()
  expect(screen.getByText('首次登录请设置新密码')).toBeInTheDocument()
})

it('shows expired reason', async () => {
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 8, max_age_days: 90 })
  useAuthStore.setState({
    user: { ...user, password_change_reason: 'expired' },
  })
  renderPage()
  expect(await screen.findByText('密码已超过 90 天未更换,请设置新密码')).toBeInTheDocument()
})

it('takes the minimum length from the school policy', async () => {
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 12, max_age_days: 0 })
  renderPage()
  expect(await screen.findByText('至少 12 位,字母、数字、符号中至少两种')).toBeInTheDocument()
})

it('blocks mismatched passwords without a request', () => {
  renderPage()
  fill('old', 'abc12345', 'abc12346')
  expect(screen.getByRole('alert')).toHaveTextContent('两次输入的新密码不一致')
  expect(authApi.changePassword).not.toHaveBeenCalled()
})

it('shows the backend message on PASSWORD_WEAK', async () => {
  vi.mocked(authApi.changePassword).mockRejectedValue(
    new ApiError(400, 'PASSWORD_WEAK', '密码太简单了'),
  )
  renderPage()
  fill('old', 'abc12345', 'abc12345')
  expect(await screen.findByRole('alert')).toHaveTextContent('密码太简单了')
})

it('on success refetches me and goes home', async () => {
  vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
  vi.mocked(authApi.me).mockResolvedValue({ ...user, must_change_password: false })
  renderPage()
  fill('old', 'abc12345', 'abc12345')
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  expect(authApi.changePassword).toHaveBeenCalledWith({
    old_password: 'old',
    new_password: 'abc12345',
    refresh_token: 'rt',
  })
  await waitFor(() => expect(useAuthStore.getState().user?.must_change_password).toBe(false))
})

it('falls back to a local flag reset when me() fails after the password changed', async () => {
  vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
  vi.mocked(authApi.me).mockRejectedValue(new Error('net'))
  renderPage()
  fill('old', 'abc12345', 'abc12345')
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  expect(screen.queryByText('修改失败,请稍后再试')).toBeNull()
  expect(useAuthStore.getState().user?.must_change_password).toBe(false)
})

it('sends an already-settled signed-in user home', () => {
  useAuthStore.setState({ user: { ...user, must_change_password: false } })
  renderPage()
  expect(screen.getByText('teacher home')).toBeInTheDocument()
})
