import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { downloadText } from '@/shared/lib/csv'
import { useAuthStore } from '@/shared/stores/auth'
import type { ImportRow } from '@/shared/types/admin'
import AccountsPage from './AccountsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: { accounts: vi.fn(), importPreview: vi.fn(), importAccounts: vi.fn() },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/shared/lib/csv')>()), downloadText: vi.fn() }))

const CSV = '登录名,姓名,工号,科目,手机\nteacher11,孙一,T011,语文,13800000011\nteacher12,钱二,,数学、英语,\n'
const row = (over: Partial<ImportRow>): ImportRow => ({
  line: 2, login_name: 'teacher11', display_name: '孙一', employee_no: 'T011', subjects: ['语文'], phone: '13800000011', error: null, ...over,
})
const goodRows = [row({}), row({ line: 3, login_name: 'teacher12', display_name: '钱二', employee_no: null, subjects: ['数学', '英语'], phone: null })]

let client: QueryClient
beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r',
    user: { id: 'me', display_name: '陈校长', contexts: ['admin'], admin_perms: ['account.manage'], must_change_password: false },
  })
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [], total: 0 })
})
afterEach(() => { cleanup(); useAuthStore.getState().logout() })

const openImport = async () => {
  render(<QueryClientProvider client={client}><AccountsPage /></QueryClientProvider>)
  await screen.findByRole('button', { name: '批量导入' })
  fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
  return screen.findByRole('dialog')
}
const pick = (csv: string) => {
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), { target: { files: [new File(['\uFEFF' + csv], 'a.csv', { type: 'text/csv' })] } })
}

it('marks bad rows red and disables the confirm button', async () => {
  vi.mocked(adminApi.importPreview).mockResolvedValue({ rows: [row({}), row({ line: 3, login_name: 'teacher01', display_name: '钱二', error: '登录名已存在' })] })
  await openImport()
  pick(CSV)
  await waitFor(() => expect(adminApi.importPreview).toHaveBeenCalledWith(CSV))
  expect(await screen.findByText('登录名已存在')).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /teacher01/ })).toHaveAttribute('data-invalid', 'true')
  expect(screen.getByRole('row', { name: /teacher11/ })).not.toHaveAttribute('data-invalid')
  expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled()
})

it('imports valid rows and lists every temp password, downloadable as CSV, gone after close', async () => {
  vi.mocked(adminApi.importPreview).mockResolvedValue({ rows: goodRows })
  vi.mocked(adminApi.importAccounts).mockResolvedValue({ created: [
    { login_name: 'teacher11', display_name: '孙一', temp_password: 'Pw1aaaaaaa' },
    { login_name: 'teacher12', display_name: '钱二', temp_password: 'Pw2bbbbbbb' },
  ] })
  await openImport()
  pick(CSV)
  const confirm = await screen.findByRole('button', { name: '确认导入' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(adminApi.importAccounts).toHaveBeenCalledWith(CSV))
  const dlg = await screen.findByRole('dialog', { name: '临时密码' })
  expect(within(dlg).getByText('Pw1aaaaaaa')).toBeInTheDocument()
  expect(within(dlg).getByText('Pw2bbbbbbb')).toBeInTheDocument()
  fireEvent.click(within(dlg).getByRole('button', { name: '下载 CSV' }))
  expect(downloadText).toHaveBeenCalledTimes(1)
  const [name, text] = vi.mocked(downloadText).mock.calls[0]
  expect(name).toMatch(/^临时密码-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(text).toContain('teacher11')
  expect(text).toContain('Pw2bbbbbbb')
  fireEvent.click(within(dlg).getAllByRole('button', { name: '关闭' })[0])
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.body.textContent).not.toContain('Pw1aaaaaaa')
  const dump = JSON.stringify([client.getQueryCache().getAll().map((q) => q.state.data), client.getMutationCache().getAll().map((m) => m.state.data)])
  expect(dump).not.toContain('Pw1aaaaaaa')
})

it('shows the backend message when importing fails', async () => {
  vi.mocked(adminApi.importPreview).mockResolvedValue({ rows: goodRows })
  vi.mocked(adminApi.importAccounts).mockRejectedValue(new ApiError(400, 'IMPORT_INVALID', '有 1 行不合格(后端)'))
  await openImport()
  pick(CSV)
  const confirm = await screen.findByRole('button', { name: '确认导入' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  expect(await screen.findByText('有 1 行不合格(后端)')).toBeInTheDocument()
})

it('previews pasted text and offers the template download', async () => {
  vi.mocked(adminApi.importPreview).mockResolvedValue({ rows: goodRows })
  await openImport()
  fireEvent.click(screen.getByRole('button', { name: '下载模板' }))
  expect(vi.mocked(downloadText).mock.calls[0][1]).toContain('登录名,姓名,工号,科目,手机')
  fireEvent.change(screen.getByLabelText('粘贴 CSV 内容'), { target: { value: CSV } })
  fireEvent.click(screen.getByRole('button', { name: '预览' }))
  await waitFor(() => expect(adminApi.importPreview).toHaveBeenCalledWith(CSV))
})
