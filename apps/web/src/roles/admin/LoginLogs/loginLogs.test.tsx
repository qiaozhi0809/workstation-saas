import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { schoolApi } from '@/shared/api/school'
import { toast } from '@/shared/components/Toast'
import { formatInTz } from '@/shared/lib/date'
import { downloadBlob } from '@/shared/lib/download'
import { localTz } from '@/shared/lib/time'
import type { LoginLog } from '@/shared/types/admin'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import AdminNav from '../AdminNav'
import { ADMIN_PAGES } from '../pages'
import LoginLogsPage from './LoginLogsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: { loginLogs: vi.fn(), loginLogsCsv: vi.fn() },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))
vi.mock('@/shared/lib/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const log = (o: Partial<LoginLog> = {}): LoginLog => ({
  id: 'l1',
  at: '2026-11-03T02:30:00Z',
  login_name: 'teacher01',
  user: { id: 'u1', display_name: '李明' },
  result: 'success',
  ip: '192.0.2.10',
  user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  suspicious: [],
  ...o,
})

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LoginLogsPage />
    </QueryClientProvider>,
  )
const lastFilters = () => vi.mocked(adminApi.loginLogs).mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
  vi.mocked(schoolApi.meta).mockResolvedValue({
    version: '1.0.0',
    school_name: '示范小学',
    school_tz: 'Asia/Shanghai',
  })
  vi.mocked(adminApi.loginLogs).mockResolvedValue({
    items: [
      log(),
      log({
        id: 'l2',
        login_name: 'ghost',
        user: null,
        result: 'unknown_user',
        ip: '198.51.100.7',
        user_agent: null,
        suspicious: ['night', 'new_network'],
      }),
    ],
    total: 2,
    page: 1,
    page_size: 50,
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('lists logs with Chinese results, browser summary and suspicious tags', async () => {
  setup()
  const row = await screen.findByRole('row', { name: /teacher01/ })
  expect(within(row).getByText('李明')).toBeInTheDocument()
  expect(within(row).getByText('成功')).toBeInTheDocument()
  expect(within(row).getByText('Chrome · Windows')).toBeInTheDocument()
  const ghost = screen.getByRole('row', { name: /ghost/ })
  expect(within(ghost).getByText('账号不存在')).toBeInTheDocument()
  expect(within(ghost).getByText('凌晨登录')).toBeInTheDocument()
  expect(within(ghost).getByText('新网络')).toBeInTheDocument()
  for (const h of ['时间', '登录名', '账号', '结果', 'IP', '浏览器', '可疑原因'])
    expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
  expect(lastFilters()).toMatchObject({ from: '2026-10-29', to: '2026-11-04', page: 1 })
})

it('filters by suspicious and result', async () => {
  setup()
  await screen.findByText('teacher01')
  fireEvent.click(screen.getByLabelText('只看可疑'))
  await waitFor(() => expect(lastFilters()).toMatchObject({ suspicious: true, page: 1 }))
  fireEvent.click(screen.getByLabelText('密码错误'))
  fireEvent.click(screen.getByLabelText('已锁定'))
  await waitFor(() => expect(lastFilters()?.result).toEqual(['bad_password', 'locked']))
})

// L134:"今天"与时间列都按学校时区,不按浏览器时区
it('computes the default range and renders times in the school time zone', async () => {
  // 18:00Z 在上海已是 11-05 凌晨 2 点;浏览器(UTC 或更西的时区)还是 11-04
  vi.setSystemTime(new Date('2026-11-04T18:00:00Z'))
  setup()
  const row = await screen.findByRole('row', { name: /teacher01/ })
  expect(lastFilters()).toMatchObject({ from: '2026-10-30', to: '2026-11-05', page: 1 })
  expect(screen.getByLabelText('开始日期')).toHaveValue('2026-10-30')
  expect(screen.getByLabelText('结束日期')).toHaveValue('2026-11-05')
  expect(within(row).getByText('2026-11-03 10:30')).toBeInTheDocument()
  expect(adminApi.loginLogs).toHaveBeenCalledTimes(1) // 等到时区已知才发第一次请求
})

it('falls back to the browser time zone when /meta fails', async () => {
  // 与上一条同一时刻:学校时区会算成 11-05,浏览器(UTC)仍是 11-04,两条用例才区分得开
  vi.setSystemTime(new Date('2026-11-04T18:00:00Z'))
  vi.mocked(schoolApi.meta).mockRejectedValue(new Error('offline'))
  setup()
  await screen.findByText('teacher01')
  const to = formatInTz(new Date().toISOString(), localTz()).slice(0, 10)
  expect(to).not.toBe('2026-11-05') // 若测试机时区恰好等于学校时区,这条就失去区分意义
  expect(lastFilters()).toMatchObject({ to })
})

// 审查 Minor 3:时区未知时日期框还不能改——否则改一头就把默认的近 7 天丢掉,发出单边区间
it('disables the date inputs until the time zone is known, then enables them', async () => {
  let resolveMeta!: (m: Awaited<ReturnType<typeof schoolApi.meta>>) => void
  vi.mocked(schoolApi.meta).mockReturnValue(new Promise((r) => (resolveMeta = r)))
  setup()
  const from = screen.getByLabelText('开始日期')
  const to = screen.getByLabelText('结束日期')
  expect(from).toBeDisabled()
  expect(to).toBeDisabled()
  expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled()
  fireEvent.change(from, { target: { value: '2026-10-01' } })
  expect(adminApi.loginLogs).not.toHaveBeenCalled()
  await act(async () => {
    resolveMeta({ version: '1.0.0', school_name: '示范小学', school_tz: 'Asia/Shanghai' })
  })
  await screen.findByText('teacher01')
  expect(from).toBeEnabled()
  expect(to).toBeEnabled()
  expect(lastFilters()).toMatchObject({ from: '2026-10-29', to: '2026-11-04' })
})

it('exports csv with the same filters through downloadBlob', async () => {
  const blob = new Blob(['a'])
  vi.mocked(adminApi.loginLogsCsv).mockResolvedValue(blob)
  setup()
  await screen.findByText('teacher01')
  fireEvent.click(screen.getByLabelText('只看可疑'))
  await waitFor(() => expect(lastFilters()?.suspicious).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
  await waitFor(() =>
    expect(downloadBlob).toHaveBeenCalledWith(blob, '登录日志-2026-10-29-2026-11-04.csv'),
  )
  const f = vi.mocked(adminApi.loginLogsCsv).mock.calls[0][0]
  expect(f).toMatchObject({ from: '2026-10-29', to: '2026-11-04', suspicious: true })
  expect(f).not.toHaveProperty('page')
})

it('toasts when the export fails', async () => {
  vi.mocked(adminApi.loginLogsCsv).mockRejectedValue(new Error('x'))
  setup()
  await screen.findByText('teacher01')
  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('导出失败,请稍后重试'))
})

it('paginates at 50 per page', async () => {
  vi.mocked(adminApi.loginLogs).mockResolvedValue({
    items: [log()],
    total: 120,
    page: 1,
    page_size: 50,
  })
  setup()
  await screen.findByText('共 120 条,第 1 / 3 页')
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(lastFilters()?.page).toBe(2))
})

const navFor = (admin_perms: AdminPerm[]) => {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: '张主任',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })
  render(
    <MemoryRouter initialEntries={['/admin/today']}>
      <AdminNav pages={ADMIN_PAGES} />
    </MemoryRouter>,
  )
}

it('hidden without audit.read', () => {
  navFor(['ai.usage', 'settings.manage'])
  fireEvent.click(screen.getByRole('button', { name: '系统' }))
  expect(screen.getByRole('menuitem', { name: 'AI 配置' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '登录日志' })).toBeNull()
  expect(ADMIN_PAGES.find((p) => p.path === 'login-logs')).toMatchObject({
    perm: 'audit.read',
    group: 'system',
    label: '登录日志',
  })
  act(() => useAuthStore.getState().logout())
})

it('is in the system menu with audit.read', () => {
  navFor(['audit.read', 'settings.manage'])
  fireEvent.click(screen.getByRole('button', { name: '系统' }))
  expect(screen.getByRole('menuitem', { name: '登录日志' })).toHaveAttribute(
    'href',
    '/admin/login-logs',
  )
  act(() => useAuthStore.getState().logout())
})
