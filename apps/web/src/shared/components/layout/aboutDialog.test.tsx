import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { schoolApi } from '@/shared/api/school'
import { useAuthStore } from '@/shared/stores/auth'
import AboutDialog from './AboutDialog'
import AccountMenu from './AccountMenu'

vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))

const META = { version: '1.0.0-rc.1', school_name: '示例小学', school_tz: 'Asia/Shanghai' }

const Wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(schoolApi.meta).mockResolvedValue(META)
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: '王老师',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('about shows version from meta', async () => {
  render(
    <Wrap>
      <AccountMenu name="王老师" onLogout={() => {}} />
    </Wrap>,
  )
  // 菜单没打开"关于"之前不请求 /meta
  expect(schoolApi.meta).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '关于' }))
  const dialog = await screen.findByRole('dialog', { name: '关于' })
  expect(within(dialog).getByText('班级工作台')).toBeInTheDocument()
  expect(await within(dialog).findByText('1.0.0-rc.1')).toBeInTheDocument()
  expect(within(dialog).getByText('示例小学')).toBeInTheDocument()
  expect(within(dialog).getByText('数据只存在学校自己的服务器上。')).toBeInTheDocument()
  // R13:仓库没有 LICENSE,"关于"里不放许可证链接
  expect(within(dialog).queryByRole('link')).toBeNull()
  expect(within(dialog).queryByText(/许可|License/i)).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('reads the version from the shared meta cache key', async () => {
  // m5d-common 约定的 ['meta'] 键:别处刚取过的缓存"关于"直接复用,不再请求
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['meta'], { ...META, version: '2.0.0' })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AboutDialog open onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  const dialog = await screen.findByRole('dialog', { name: '关于' })
  expect(within(dialog).getByText('2.0.0')).toBeInTheDocument()
  expect(schoolApi.meta).not.toHaveBeenCalled()
})

it('shows a loading line until meta arrives', async () => {
  vi.mocked(schoolApi.meta).mockReturnValue(new Promise(() => {}))
  render(
    <Wrap>
      <AboutDialog open onClose={() => {}} />
    </Wrap>,
  )
  const dialog = await screen.findByRole('dialog', { name: '关于' })
  expect(within(dialog).getByText('班级工作台')).toBeInTheDocument()
  expect(within(dialog).getByRole('status')).toHaveTextContent('加载中…')
  expect(within(dialog).queryByText('版本')).toBeNull()
  expect(within(dialog).getByText('数据只存在学校自己的服务器上。')).toBeInTheDocument()
})

it('shows a retry when meta fails to load', async () => {
  vi.mocked(schoolApi.meta).mockRejectedValueOnce(new Error('net'))
  render(
    <Wrap>
      <AboutDialog open onClose={() => {}} />
    </Wrap>,
  )
  const dialog = await screen.findByRole('dialog', { name: '关于' })
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('没有取到版本信息')
  // 失败时产品名与数据承诺仍然显示
  expect(within(dialog).getByText('班级工作台')).toBeInTheDocument()
  expect(within(dialog).getByText('数据只存在学校自己的服务器上。')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
  expect(await within(dialog).findByText('1.0.0-rc.1')).toBeInTheDocument()
})
