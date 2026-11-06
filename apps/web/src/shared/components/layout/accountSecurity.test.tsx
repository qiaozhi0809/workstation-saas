import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import AccountMenu from './AccountMenu'

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    totpStatus: vi.fn(),
    totpSetup: vi.fn(),
    totpEnable: vi.fn(),
    totpDisable: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
  qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
}

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'rt', user: null, lastContext: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

const open = async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AccountMenu name="王老师" onLogout={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '账号安全' }))
  return screen.findByRole('dialog')
}

it('not allowed state', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: false,
    enabled: false,
    enabled_at: null,
  })
  const dlg = await open()
  expect(await within(dlg).findByText('学校未开启两步验证')).toBeInTheDocument()
  expect(within(dlg).queryByRole('button', { name: '开启' })).toBeNull()
})

it('enable flow shows qr and confirms', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: false,
    enabled_at: null,
  })
  vi.mocked(authApi.totpSetup).mockResolvedValue(SETUP)
  vi.mocked(authApi.totpEnable).mockResolvedValue({ enabled: true })
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '开启' }))
  const img = await within(dlg).findByRole('img', { name: '两步验证二维码' })
  expect(img.getAttribute('src')).toBe(
    'data:image/svg+xml;utf8,' + encodeURIComponent(SETUP.qr_svg),
  )
  expect(dlg.innerHTML).not.toContain('<rect width="1"') // 不内联注入 SVG
  expect(within(dlg).getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
  fireEvent.change(within(dlg).getByLabelText('验证码'), { target: { value: '123456' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  await waitFor(() => expect(authApi.totpEnable).toHaveBeenCalledWith('123456', 'rt'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已开启两步验证'))
})

it('disable requires password', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: true,
    enabled_at: '2026-11-01T08:00:00+08:00',
  })
  vi.mocked(authApi.totpDisable)
    .mockRejectedValueOnce(new ApiError(400, 'WRONG_PASSWORD', '密码不正确'))
    .mockResolvedValueOnce({ enabled: false })
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '关闭两步验证' }))
  const confirm = within(dlg).getByRole('button', { name: '确认关闭' })
  expect(confirm).toBeDisabled()
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: 'wrong' } })
  fireEvent.click(confirm)
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('密码不正确')
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: 'right-pw' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确认关闭' }))
  await waitFor(() => expect(authApi.totpDisable).toHaveBeenLastCalledWith('right-pw'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已关闭两步验证'))
})
