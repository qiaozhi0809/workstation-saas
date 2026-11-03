import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { useAuthStore } from '@/shared/stores/auth'
import AccountMenu from './AccountMenu'

vi.mock('@/shared/api/auth', () => ({ authApi: { changePassword: vi.fn(), me: vi.fn() } }))

const user = { id: 'u', display_name: '王老师', contexts: ['teacher' as const], admin_perms: [], must_change_password: false }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'rt', user, lastContext: null })
})
afterEach(() => { cleanup(); useAuthStore.getState().logout() })

it('changes the password from the account menu and closes', async () => {
  vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
  vi.mocked(authApi.me).mockResolvedValue(user)
  render(<MemoryRouter><AccountMenu name="王老师" onLogout={() => {}} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '修改密码' }))
  fireEvent.change(await screen.findByLabelText('旧密码'), { target: { value: 'old' } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abc12345' } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'abc12345' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(authApi.changePassword).toHaveBeenCalledWith({ old_password: 'old', new_password: 'abc12345', refresh_token: 'rt' })
})

it('switchTo records the last context before navigating', () => {
  render(<MemoryRouter><AccountMenu name="王老师" onLogout={() => {}} switchTo={{ label: '切换到管理端', to: '/admin', context: 'admin' }} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '切换到管理端' }))
  expect(useAuthStore.getState().lastContext).toBe('admin')
})

it('closes without a failure message when me() fails after the password changed', async () => {
  vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
  vi.mocked(authApi.me).mockRejectedValue(new Error('net'))
  render(<MemoryRouter><AccountMenu name="王老师" onLogout={() => {}} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '修改密码' }))
  fireEvent.change(await screen.findByLabelText('旧密码'), { target: { value: 'old' } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abc12345' } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'abc12345' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('修改失败,请稍后再试')).toBeNull()
})
