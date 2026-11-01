import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import LoginPage from './LoginPage'

vi.mock('@/shared/api/auth', () => ({ authApi: { login: vi.fn() } }))

const fill = (login: string, pw: string) => {
  fireEvent.change(screen.getByLabelText('登录名'), { target: { value: login } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: pw } })
  fireEvent.click(screen.getByRole('button', { name: /登录/ }))
}

beforeEach(() => {
  vi.mocked(authApi.login).mockReset()
  useAuthStore.getState().logout()
})

afterEach(() => {
  useAuthStore.getState().logout()
})

it('submits trimmed login name and unicode password', async () => {   // Review Focus #5
  vi.mocked(authApi.login).mockResolvedValue({
    access_token: 'a', refresh_token: 'r', expires_at: 'x', user: { id: 'u', display_name: 't' },
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

it('shows generic message for other errors', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new Error('network'))
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fill('teacher01', 'x')
  expect(await screen.findByRole('alert')).toHaveTextContent('登录失败,请稍后再试')
})

it('stores tokens and navigates to /teacher on success', async () => {
  const user = { id: 'u', display_name: 't' }
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

  let resolve!: (v: never) => void
  vi.mocked(authApi.login).mockReturnValueOnce(new Promise((r) => { resolve = r as typeof resolve }))
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  const btn = await screen.findByRole('button', { name: '登录中…' })
  expect(btn).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  resolve(undefined as never)
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled())
})
