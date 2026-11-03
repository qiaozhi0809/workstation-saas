import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import ChangePasswordPage from './ChangePasswordPage'

vi.mock('@/shared/api/auth', () => ({ authApi: { changePassword: vi.fn(), me: vi.fn() } }))

const user = { id: 'u', display_name: 't', contexts: ['teacher' as const], admin_perms: [], must_change_password: true }

const fill = (oldPw: string, newPw: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText('旧密码'), { target: { value: oldPw } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPw } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/change-password']}>
    <Routes>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/teacher" element={<div>teacher home</div>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'rt', user, lastContext: null })
})
afterEach(() => { cleanup(); useAuthStore.getState().logout() })

it('shows the heading and the rule hint', () => {
  renderPage()
  expect(screen.getByRole('heading', { name: '首次登录请先修改密码' })).toBeInTheDocument()
  expect(screen.getByText('至少 8 位,字母、数字、符号中至少两种')).toBeInTheDocument()
})

it('blocks mismatched passwords without a request', () => {
  renderPage()
  fill('old', 'abc12345', 'abc12346')
  expect(screen.getByRole('alert')).toHaveTextContent('两次输入的新密码不一致')
  expect(authApi.changePassword).not.toHaveBeenCalled()
})

it('shows the backend message on PASSWORD_WEAK', async () => {
  vi.mocked(authApi.changePassword).mockRejectedValue(new ApiError(400, 'PASSWORD_WEAK', '密码太简单了'))
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
  expect(authApi.changePassword).toHaveBeenCalledWith({ old_password: 'old', new_password: 'abc12345', refresh_token: 'rt' })
  await waitFor(() => expect(useAuthStore.getState().user?.must_change_password).toBe(false))
})
