import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { META_QUERY_KEY } from '@/shared/hooks/useSchoolTz'
import { useAuthStore } from '@/shared/stores/auth'
import ChangePasswordPage from './ChangePasswordPage'

vi.mock('@/shared/api/auth', () => ({
  authApi: { changePassword: vi.fn(), me: vi.fn(), passwordPolicy: vi.fn() },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))

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

const renderPage = (
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/teacher" element={<div>teacher home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 8, max_age_days: 0 })
  // 挂载时重取的 /auth/me 默认回同一个用户;V3-3 合并前 /meta 在强制改密中是 403
  vi.mocked(authApi.me).mockResolvedValue(user)
  vi.mocked(schoolApi.meta).mockRejectedValue(
    new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改密码'),
  )
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'rt', user, lastContext: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('shows the heading and the rule hint', async () => {
  renderPage()
  expect(
    screen.getByRole('heading', { name: '管理员设置了临时密码,请先修改密码' }),
  ).toBeInTheDocument()
  expect(await screen.findByText('至少 8 位,字母、数字、符号中至少两种')).toBeInTheDocument()
  expect(screen.getByText('管理员设置了临时密码,请设置新密码')).toBeInTheDocument()
})

it('shows expired reason', async () => {
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 8, max_age_days: 90 })
  const expired = { ...user, password_change_reason: 'expired' as const }
  useAuthStore.setState({ user: expired })
  vi.mocked(authApi.me).mockResolvedValue(expired)
  renderPage()
  expect(await screen.findByText('密码已超过 90 天未更换,请设置新密码')).toBeInTheDocument()
})

it('shows neutral copy when the reason is unknown (required, or a value this build does not know)', () => {
  // 会话中撞到 403 PASSWORD_CHANGE_REQUIRED 而 /auth/me 取不到原因时,client.ts 兜底写 'required';
  // 将来后端若新增原因值,也按同样的中性文案显示,不冒充"首次登录"或"已过期"
  for (const reason of ['required', 'reset']) {
    const u = { ...user, password_change_reason: reason as 'required' }
    useAuthStore.setState({ user: u })
    vi.mocked(authApi.me).mockResolvedValue(u)
    renderPage()
    expect(screen.getByRole('heading', { name: '请先修改密码' })).toBeInTheDocument()
    expect(screen.getByText('管理员要求你先修改密码')).toBeInTheDocument()
    expect(screen.queryByText(/首次登录/)).toBeNull()
    expect(screen.queryByText(/过期|未更换/)).toBeNull()
    cleanup()
  }
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
  // 挂载时那一次 /auth/me 仍说要改;改成功后再取才是不用改了
  vi.mocked(authApi.me)
    .mockResolvedValueOnce(user)
    .mockResolvedValueOnce({ ...user, must_change_password: false })
  renderPage()
  await waitFor(() => expect(authApi.me).toHaveBeenCalledTimes(1))
  fill('old', 'abc12345', 'abc12345')
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  expect(authApi.changePassword).toHaveBeenCalledWith({
    old_password: 'old',
    new_password: 'abc12345',
    refresh_token: 'rt',
  })
  expect(authApi.me).toHaveBeenCalledTimes(2)
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
  expect(authApi.me).not.toHaveBeenCalled()
})

it('refetches me on mount', async () => {
  // L307:挂载时重取一次 /auth/me——client.ts 兜底写进 store 的 'required' 只是占位,换成服务端的真实原因
  useAuthStore.setState({ user: { ...user, password_change_reason: 'required' } })
  vi.mocked(authApi.me).mockResolvedValue({ ...user, password_change_reason: 'expired' })
  vi.mocked(authApi.passwordPolicy).mockResolvedValue({ min_length: 8, max_age_days: 90 })
  renderPage()
  expect(screen.getByText('管理员要求你先修改密码')).toBeInTheDocument()
  expect(await screen.findByText('密码已超过 90 天未更换,请设置新密码')).toBeInTheDocument()
  expect(screen.queryByText('管理员要求你先修改密码')).toBeNull()
  expect(authApi.me).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().user?.password_change_reason).toBe('expired')
})

it('goes home when /auth/me says the password no longer needs changing', async () => {
  // 在别的标签 / 设备上已经改过:挂载时拿到最新的 must_change_password=false,不再要求改
  vi.mocked(authApi.me).mockResolvedValue({
    ...user,
    must_change_password: false,
    password_change_reason: null,
  })
  renderPage()
  expect(await screen.findByText('teacher home')).toBeInTheDocument()
  expect(authApi.me).toHaveBeenCalledTimes(1)
  expect(authApi.changePassword).not.toHaveBeenCalled()
})

it('keeps the local reason when /auth/me fails', async () => {
  vi.mocked(authApi.me).mockRejectedValue(new Error('net'))
  renderPage()
  await waitFor(() => expect(authApi.me).toHaveBeenCalledTimes(1))
  await act(async () => {})
  expect(screen.getByText('管理员设置了临时密码,请设置新密码')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(useAuthStore.getState().user?.password_change_reason).toBe('first_login')
})

it('shows the school name from /meta and stays quiet when it is forbidden', async () => {
  vi.mocked(schoolApi.meta).mockResolvedValue({
    version: '1.0.0',
    school_name: '示例小学',
    school_tz: 'Asia/Shanghai',
  })
  renderPage()
  expect(await screen.findByText('示例小学')).toBeInTheDocument()
  cleanup()
  // V3-3 合并前 /meta 在强制改密中 403(以及断网):不显示校名、不报错、不重试
  // (这里用默认重试策略的 QueryClient:查询失败后应直接进 error,而不是挂在 pending 等重试)
  vi.mocked(schoolApi.meta).mockRejectedValue(
    new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改密码'),
  )
  const client = renderPage(new QueryClient())
  await waitFor(() => expect(schoolApi.meta).toHaveBeenCalledTimes(2))
  await act(async () => {})
  expect(screen.queryByText('示例小学')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    screen.getByRole('heading', { name: '管理员设置了临时密码,请先修改密码' }),
  ).toBeInTheDocument()
  expect(client.getQueryState(META_QUERY_KEY)?.status).toBe('error')
  expect(schoolApi.meta).toHaveBeenCalledTimes(2)
})
