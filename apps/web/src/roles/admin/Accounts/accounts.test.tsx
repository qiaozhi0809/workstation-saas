import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import type { Account } from '@/shared/types/admin'
import AccountsPage from './AccountsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    accounts: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    resetPassword: vi.fn(),
    freeze: vi.fn(),
    unfreeze: vi.fn(),
    importPreview: vi.fn(),
    importAccounts: vi.fn(),
    resetTotp: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const acc = (over: Partial<Account> = {}): Account => ({
  id: 'u1',
  login_name: 'teacher01',
  display_name: '李明',
  phone: '13800000001',
  employee_no: 'T001',
  subjects: ['语文'],
  status: 'active',
  must_change_password: false,
  last_login_at: null,
  roles: [{ role: 'homeroom_teacher', label: '三年二班 班主任' }],
  totp_enabled: false,
  ...over,
})
const me = acc({
  id: 'me',
  login_name: 'admin01',
  display_name: '陈校长',
  roles: [{ role: 'principal', label: '校长' }],
})
const other = acc({
  id: 'u2',
  login_name: 'teacher02',
  display_name: '王芳',
  employee_no: null,
  roles: [],
})
const frozen = acc({ id: 'u3', login_name: 'teacher03', display_name: '赵强', status: 'frozen' })

let client: QueryClient
const renderPage = () =>
  render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'me',
      display_name: '陈校长',
      contexts: ['admin'],
      admin_perms: ['account.manage'],
      must_change_password: false,
      password_change_reason: null,
    },
  })
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [me, acc(), other, frozen], total: 4 })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

const dump = () =>
  JSON.stringify([
    client
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
    client
      .getMutationCache()
      .getAll()
      .map((m) => [m.state.data, m.state.variables]),
  ])

it('lists accounts with role tags and the fixed filters', async () => {
  renderPage()
  expect(await screen.findByText('王芳')).toBeInTheDocument()
  for (const h of ['姓名', '登录名', '身份', '工号', '最后登录', '状态', '操作'])
    expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
  expect(screen.getAllByText('三年二班 班主任').length).toBeGreaterThan(0)
  expect(screen.getByLabelText('搜索姓名或登录名')).toBeInTheDocument()
  const roles = within(screen.getByLabelText('身份'))
    .getAllByRole('option')
    .map((o) => o.textContent)
  expect(roles).toEqual([
    '全部',
    '班主任',
    '副班主任',
    '任课老师',
    '校长',
    '教导主任',
    '年级组长',
    '信息中心',
  ])
  const states = within(screen.getByLabelText('状态'))
    .getAllByRole('option')
    .map((o) => o.textContent)
  expect(states).toEqual(['全部', '在用', '已冻结'])
  expect(screen.getAllByText('从未登录').length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: '批量导入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '新建账号' })).toBeInTheDocument()
})

it('shows the temp password once after creating an account and keeps it nowhere afterwards', async () => {
  vi.mocked(adminApi.createAccount).mockResolvedValue({
    account: acc({ id: 'u9', login_name: 'teacher09', display_name: '周新' }),
    temp_password: 'Zx7Qm4Kd9P',
  })
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(screen.getByRole('button', { name: '新建账号' }))
  fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'teacher09' } })
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: ' 周新 ' } })
  fireEvent.change(screen.getByLabelText('科目'), { target: { value: '语文、数学/英语' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('Zx7Qm4Kd9P')).toBeInTheDocument()
  expect(adminApi.createAccount).toHaveBeenCalledWith({
    login_name: 'teacher09',
    display_name: '周新',
    phone: null,
    employee_no: null,
    subjects: ['语文', '数学', '英语'],
  })
  expect(screen.getByRole('dialog', { name: '临时密码' })).toHaveTextContent(
    '请把下面的密码交给本人,关闭后不再显示;对方首次登录需要修改密码。',
  )
  fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0])
  await waitFor(() => expect(screen.queryByText('Zx7Qm4Kd9P')).toBeNull())
  expect(document.body.textContent).not.toContain('Zx7Qm4Kd9P')
  expect(dump()).not.toContain('Zx7Qm4Kd9P')
  expect(vi.mocked(adminApi.accounts).mock.calls.length).toBeGreaterThan(1) // 创建后刷新了列表
})

it('copies the temp password', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  vi.mocked(adminApi.resetPassword).mockResolvedValue({ temp_password: 'Ab3Cd5Ef7G' })
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '重置密码' }),
  )
  await screen.findByText('Ab3Cd5Ef7G')
  fireEvent.click(screen.getByRole('button', { name: '复制' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Ab3Cd5Ef7G'))
})

it('shows the reset password once and clears it on close', async () => {
  vi.mocked(adminApi.resetPassword).mockResolvedValue({ temp_password: 'Rt8Yu2Op6N' })
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /李明/ })).getByRole('button', { name: '重置密码' }),
  )
  expect(await screen.findByText('Rt8Yu2Op6N')).toBeInTheDocument()
  expect(adminApi.resetPassword).toHaveBeenCalledWith('u1')
  fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0])
  await waitFor(() => expect(screen.queryByText('Rt8Yu2Op6N')).toBeNull())
  expect(dump()).not.toContain('Rt8Yu2Op6N')
})

it('disables freezing your own account with a hint', async () => {
  renderPage()
  await screen.findByText('陈校长')
  const row = screen.getByRole('row', { name: /陈校长/ })
  expect(within(row).getByRole('button', { name: '冻结' })).toBeDisabled()
  expect(within(row).getByText('不能冻结自己的账号')).toBeVisible()
  expect(within(row).getByText('不能冻结自己的账号')).not.toHaveClass('sr-only')
  const otherRow = screen.getByRole('row', { name: /王芳/ })
  expect(within(otherRow).getByRole('button', { name: '冻结' })).toBeEnabled()
})

it('confirms before freezing and unfreezes directly', async () => {
  vi.mocked(adminApi.freeze).mockResolvedValue(acc({ id: 'u2', status: 'frozen' }))
  vi.mocked(adminApi.unfreeze).mockResolvedValue(acc({ id: 'u3' }))
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '冻结' }),
  )
  const dlg = await screen.findByRole('dialog')
  expect(dlg).toHaveTextContent('冻结后 王芳 会立即退出登录,不能再登录;历史记录保留。')
  expect(adminApi.freeze).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认冻结' }))
  await waitFor(() => expect(adminApi.freeze).toHaveBeenCalledWith('u2'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(
    within(screen.getByRole('row', { name: /赵强/ })).getByRole('button', { name: '解冻' }),
  )
  await waitFor(() => expect(adminApi.unfreeze).toHaveBeenCalledWith('u3'))
})

it('shows the backend message when freezing fails', async () => {
  vi.mocked(adminApi.freeze).mockRejectedValue(
    new ApiError(409, 'CANNOT_FREEZE_SELF', '不能冻结自己的账号(后端)'),
  )
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '冻结' }),
  )
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: '确认冻结' }),
  )
  expect(await screen.findByText('不能冻结自己的账号(后端)')).toBeInTheDocument()
})

it('edits an account without letting the login name change', async () => {
  vi.mocked(adminApi.updateAccount).mockResolvedValue(acc())
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /李明/ })).getByRole('button', { name: '编辑' }),
  )
  expect(screen.getByLabelText('登录名')).toHaveValue('teacher01')
  expect(screen.getByLabelText('登录名')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('工号'), { target: { value: 'T009' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(adminApi.updateAccount).toHaveBeenCalledWith('u1', {
      display_name: '李明',
      phone: '13800000001',
      employee_no: 'T009',
      subjects: ['语文'],
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(toast).toHaveBeenCalledWith('已保存李明')
})

it('shows the backend message when the login name is taken', async () => {
  vi.mocked(adminApi.createAccount).mockRejectedValue(
    new ApiError(409, 'LOGIN_TAKEN', '这个登录名已经有人用了'),
  )
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(screen.getByRole('button', { name: '新建账号' }))
  fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'teacher01' } })
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李明' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('这个登录名已经有人用了')).toBeInTheDocument()
})

it('sends filters and returns to page 1 when one changes', async () => {
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [me, other], total: 120 })
  renderPage()
  await screen.findByText('王芳')
  expect(adminApi.accounts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() =>
    expect(adminApi.accounts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
  )
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'frozen' } })
  await waitFor(() =>
    expect(adminApi.accounts).toHaveBeenLastCalledWith({
      q: undefined,
      role: undefined,
      status: 'frozen',
      page: 1,
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() =>
    expect(adminApi.accounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'frozen', page: 2 }),
    ),
  )
  fireEvent.change(screen.getByLabelText('身份'), { target: { value: 'grade_head' } })
  await waitFor(() =>
    expect(adminApi.accounts).toHaveBeenLastCalledWith({
      q: undefined,
      role: 'grade_head',
      status: 'frozen',
      page: 1,
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  fireEvent.change(screen.getByLabelText('搜索姓名或登录名'), { target: { value: '王' } })
  await waitFor(() =>
    expect(adminApi.accounts).toHaveBeenLastCalledWith({
      q: '王',
      role: 'grade_head',
      status: 'frozen',
      page: 1,
    }),
  )
})

it('shows an error state with retry when loading fails', async () => {
  vi.mocked(adminApi.accounts).mockRejectedValueOnce(new ApiError(500, 'X', '加载失败了(后端)'))
  renderPage()
  expect(await screen.findByText('加载失败了(后端)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('王芳')).toBeInTheDocument()
})

it('clears an old freeze error on the next attempt and ignores double clicks', async () => {
  let release!: () => void
  vi.mocked(adminApi.freeze)
    .mockRejectedValueOnce(new ApiError(409, 'X', '第一次失败(后端)'))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r(acc({ id: 'u2', status: 'frozen' }))
        }),
    )
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '冻结' }),
  )
  const dlg = await screen.findByRole('dialog')
  fireEvent.click(within(dlg).getByRole('button', { name: '确认冻结' }))
  expect(await screen.findByText('第一次失败(后端)')).toBeInTheDocument()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认冻结' }))
  await waitFor(() => expect(screen.queryByText('第一次失败(后端)')).toBeNull())
  expect(within(dlg).getByRole('button', { name: '确认冻结' })).toBeDisabled()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认冻结' }))
  expect(adminApi.freeze).toHaveBeenCalledTimes(2)
  release()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('hides reset password on your own row', async () => {
  renderPage()
  await screen.findByText('陈校长')
  expect(
    within(screen.getByRole('row', { name: /陈校长/ })).queryByRole('button', { name: '重置密码' }),
  ).toBeNull()
  expect(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '重置密码' }),
  ).toBeInTheDocument()
})

it('shows the backend message if resetting is still refused', async () => {
  vi.mocked(adminApi.resetPassword).mockRejectedValue(
    new ApiError(409, 'CANNOT_RESET_SELF', '不能重置自己的密码,请用修改密码'),
  )
  renderPage()
  await screen.findByText('王芳')
  fireEvent.click(
    within(screen.getByRole('row', { name: /王芳/ })).getByRole('button', { name: '重置密码' }),
  )
  await waitFor(() => expect(toast).toHaveBeenCalledWith('不能重置自己的密码,请用修改密码'))
})

const withTotp = acc({
  id: 'u7',
  login_name: 'teacher07',
  display_name: '孙丽',
  totp_enabled: true,
})
const meTotp = { ...me, totp_enabled: true }

it('marks 2FA accounts and offers reset only for them, never on your own row', async () => {
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [meTotp, withTotp, other], total: 3 })
  renderPage()
  await screen.findByText('孙丽')
  const row = screen.getByRole('row', { name: /孙丽/ })
  expect(within(row).getByText('两步验证')).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: '重置两步验证' })).toBeInTheDocument()
  const plain = screen.getByRole('row', { name: /王芳/ })
  expect(within(plain).queryByText('两步验证')).toBeNull()
  expect(within(plain).queryByRole('button', { name: '重置两步验证' })).toBeNull()
  const mine = screen.getByRole('row', { name: /陈校长/ })
  expect(within(mine).getByText('两步验证')).toBeInTheDocument()
  expect(within(mine).queryByRole('button', { name: '重置两步验证' })).toBeNull()
})

it('resets totp after confirm', async () => {
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [me, withTotp], total: 2 })
  vi.mocked(adminApi.resetTotp).mockResolvedValue({ ok: true })
  renderPage()
  await screen.findByText('孙丽')
  fireEvent.click(
    within(screen.getByRole('row', { name: /孙丽/ })).getByRole('button', { name: '重置两步验证' }),
  )
  const dlg = screen.getByRole('dialog', { name: '重置两步验证' })
  expect(dlg).toHaveTextContent('该账号下次登录只需密码')
  expect(adminApi.resetTotp).not.toHaveBeenCalled()
  const before = vi.mocked(adminApi.accounts).mock.calls.length
  fireEvent.click(within(dlg).getByRole('button', { name: '确认重置' }))
  await waitFor(() => expect(adminApi.resetTotp).toHaveBeenCalledWith('u7'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已重置孙丽的两步验证'))
  await waitFor(() =>
    expect(vi.mocked(adminApi.accounts).mock.calls.length).toBeGreaterThan(before),
  )
  expect(screen.queryByRole('dialog', { name: '重置两步验证' })).toBeNull()
})

// L321:变更之前就已在飞的列表请求(搜索防抖刚发出的新查询,还没有任何数据)不能后到胜出——
// 刷新要先取消它再重取,界面不能停在变更前的状态(e2e m5b 重置两步验证后按钮不消失)
it('in-flight list fetch is cancelled on refresh', async () => {
  const stale = { items: [me, withTotp], total: 2 }
  const fresh = { items: [me, { ...withTotp, totp_enabled: false }], total: 2 }
  let release!: (page: typeof stale) => void
  vi.mocked(adminApi.accounts)
    .mockResolvedValueOnce(stale) // 首屏
    .mockImplementationOnce(() => new Promise((r) => (release = r))) // 搜索 "孙" 的新查询,变更前发出、一直没回
    .mockResolvedValue(fresh) // 变更后的任何重取
  vi.mocked(adminApi.resetTotp).mockResolvedValue({ ok: true })
  renderPage()
  await screen.findByText('孙丽')
  fireEvent.change(screen.getByLabelText('搜索姓名或登录名'), { target: { value: '孙' } })
  await waitFor(() => expect(adminApi.accounts).toHaveBeenCalledTimes(2))
  const searchCalls = () =>
    vi.mocked(adminApi.accounts).mock.calls.filter(([f]) => f?.q === '孙').length
  expect(searchCalls()).toBe(1)
  // 列表还显示着上一页数据(keepPreviousData),在上面重置孙丽的两步验证
  fireEvent.click(
    within(screen.getByRole('row', { name: /孙丽/ })).getByRole('button', { name: '重置两步验证' }),
  )
  fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
  await waitFor(() => expect(adminApi.resetTotp).toHaveBeenCalledWith('u7'))
  // 刷新后对同一个搜索条件再发了一次请求,而不是等那个变更前的请求
  await waitFor(() => expect(searchCalls()).toBe(2))
  await waitFor(() =>
    expect(
      within(screen.getByRole('row', { name: /孙丽/ })).queryByRole('button', {
        name: '重置两步验证',
      }),
    ).toBeNull(),
  )
  // 变更前的请求这时才回来:结果已被丢弃,按钮不会再出现
  release(stale)
  await new Promise((r) => setTimeout(r, 0))
  expect(
    within(screen.getByRole('row', { name: /孙丽/ })).queryByRole('button', {
      name: '重置两步验证',
    }),
  ).toBeNull()
})

it('shows a readable message when resetting yourself is rejected', async () => {
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [me, withTotp], total: 2 })
  vi.mocked(adminApi.resetTotp).mockRejectedValue(
    new ApiError(409, 'CANNOT_RESET_SELF', 'cannot reset self'),
  )
  renderPage()
  await screen.findByText('孙丽')
  fireEvent.click(
    within(screen.getByRole('row', { name: /孙丽/ })).getByRole('button', { name: '重置两步验证' }),
  )
  fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('不能重置自己的两步验证')
})
