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
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: 'my-pw' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  await waitFor(() => expect(authApi.totpEnable).toHaveBeenCalledWith('123456', 'my-pw', 'rt'))
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

const startEnable = async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: false,
    enabled_at: null,
  })
  vi.mocked(authApi.totpSetup).mockResolvedValue(SETUP)
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '开启' }))
  await within(dlg).findByRole('img', { name: '两步验证二维码' })
  return dlg
}
const fillEnable = (dlg: HTMLElement, code: string, pw: string) => {
  fireEvent.change(within(dlg).getByLabelText('验证码'), { target: { value: code } })
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: pw } })
}

it('enable requires current password', async () => {
  const dlg = await startEnable()
  const pw = within(dlg).getByLabelText('当前密码')
  expect(pw).toHaveAttribute('type', 'password')
  expect(pw).toHaveAttribute('autocomplete', 'current-password')
  const confirm = within(dlg).getByRole('button', { name: '确认开启' })
  fireEvent.change(within(dlg).getByLabelText('验证码'), { target: { value: '123456' } })
  expect(confirm).toBeDisabled()
  fireEvent.change(pw, { target: { value: 'x' } })
  expect(confirm).toBeEnabled()
})

it('wrong password keeps the code and clears only the password', async () => {
  vi.mocked(authApi.totpEnable).mockRejectedValue(new ApiError(400, 'WRONG_PASSWORD', 'bad'))
  const dlg = await startEnable()
  fillEnable(dlg, '123456', 'nope')
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('密码不正确')
  expect(within(dlg).getByLabelText('验证码')).toHaveValue('123456')
  expect(within(dlg).getByLabelText('当前密码')).toHaveValue('')
})

it('enable shows the lockout message on 429 ACCOUNT_LOCKED', async () => {
  vi.mocked(authApi.totpEnable).mockRejectedValue(new ApiError(429, 'ACCOUNT_LOCKED', 'locked'))
  const dlg = await startEnable()
  fillEnable(dlg, '123456', 'pw')
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('尝试次数过多,请稍后再试')
})

it('enable keeps its own TOTP_INVALID message', async () => {
  vi.mocked(authApi.totpEnable).mockRejectedValue(new ApiError(400, 'TOTP_INVALID', 'bad'))
  const dlg = await startEnable()
  fillEnable(dlg, '123456', 'pw')
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent(
    '验证码不正确或已过期,请检查手机时间',
  )
})

it('expired setup restarts the setup step', async () => {
  vi.mocked(authApi.totpEnable).mockRejectedValue(new ApiError(409, 'TOTP_SETUP_EXPIRED', 'gone'))
  const dlg = await startEnable()
  fillEnable(dlg, '123456', 'pw')
  fireEvent.click(within(dlg).getByRole('button', { name: '确认开启' }))
  await waitFor(() => expect(authApi.totpSetup).toHaveBeenCalledTimes(2))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('二维码已过期,请重新开启')
  await within(dlg).findByRole('img', { name: '两步验证二维码' })
  expect(within(dlg).getByLabelText('验证码')).toHaveValue('')
  expect(within(dlg).getByLabelText('当前密码')).toHaveValue('')
})

it('disable shows the lockout message on 429 ACCOUNT_LOCKED', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: true,
    enabled_at: '2026-11-01T08:00:00+08:00',
  })
  vi.mocked(authApi.totpDisable).mockRejectedValue(new ApiError(429, 'ACCOUNT_LOCKED', 'locked'))
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '关闭两步验证' }))
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: 'pw' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确认关闭' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('尝试次数过多,请稍后再试')
})

it('setup failure shows the error with a retry button that calls setup again', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: false,
    enabled_at: null,
  })
  vi.mocked(authApi.totpSetup)
    .mockRejectedValueOnce(new ApiError(503, 'HTTP_ERROR', 'Service Unavailable'))
    .mockResolvedValueOnce(SETUP)
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '开启' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('Service Unavailable')
  expect(within(dlg).queryByRole('img', { name: '两步验证二维码' })).toBeNull()
  const retry = within(dlg).getByRole('button', { name: '重试' })
  expect(within(dlg).getByRole('button', { name: '取消' })).toBeInTheDocument()
  fireEvent.click(retry)
  await waitFor(() => expect(authApi.totpSetup).toHaveBeenCalledTimes(2))
  await within(dlg).findByRole('img', { name: '两步验证二维码' })
  expect(within(dlg).queryByRole('alert')).toBeNull()
  expect(within(dlg).queryByRole('button', { name: '重试' })).toBeNull()
})

it('disable confirm shows a spinner and stays disabled while submitting', async () => {
  vi.mocked(authApi.totpStatus).mockResolvedValue({
    allowed: true,
    enabled: true,
    enabled_at: '2026-11-01T08:00:00+08:00',
  })
  let resolveDisable!: (v: { enabled: false }) => void
  vi.mocked(authApi.totpDisable).mockReturnValue(
    new Promise<{ enabled: false }>((r) => {
      resolveDisable = r
    }),
  )
  const dlg = await open()
  fireEvent.click(await within(dlg).findByRole('button', { name: '关闭两步验证' }))
  fireEvent.change(within(dlg).getByLabelText('当前密码'), { target: { value: 'pw' } })
  const confirm = within(dlg).getByRole('button', { name: '确认关闭' })
  expect(confirm.querySelector('svg')).toBeNull()
  fireEvent.click(confirm)
  await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'))
  expect(confirm).toBeDisabled()
  expect(confirm.querySelector('svg.motion-safe\\:animate-spin')).not.toBeNull()
  resolveDisable({ enabled: false })
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已关闭两步验证'))
})

it('reopening the dialog shows no qr or secret until setup is called again', async () => {
  const dlg = await startEnable()
  expect(within(dlg).getByRole('img', { name: '两步验证二维码' })).toBeInTheDocument()
  fireEvent.keyDown(dlg, { key: 'Escape' })
  if (screen.queryByRole('dialog')) {
    fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '账号安全' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '账号安全' }))
  }
  const again = await screen.findByRole('dialog')
  expect(within(again).queryByRole('img', { name: '两步验证二维码' })).toBeNull()
  expect(again.textContent).not.toContain('JBSW')
  expect(authApi.totpSetup).toHaveBeenCalledTimes(1)
})
