import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { parentLinksApi } from '@/shared/api/parentLinks'
import { studentsApi } from '@/shared/api/students'
import { Toaster } from '@/shared/components/Toast'
import type { ClassPerm } from '@/shared/types/classroom'
import type { ParentOfStudent } from '@/shared/types/parent'
import type { StudentProfile } from '@/shared/types/student'
import ParentsTab from './ParentsTab'
import StudentProfileDrawer from './StudentProfileDrawer'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))
vi.mock('@/shared/api/parentLinks', () => ({
  parentLinksApi: {
    list: vi.fn(),
    create: vi.fn(),
    setPrimary: vi.fn(),
    unlink: vi.fn(),
    resetPassword: vi.fn(),
  },
}))
vi.mock('@/shared/api/comments', () => ({
  commentsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}))
vi.mock('@/shared/api/growth', () => ({
  growthApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}))
vi.mock('@/shared/api/reviews', () => ({
  reviewsApi: { listForStudent: vi.fn(), summary: vi.fn() },
}))
// 及格 / 优秀比例固定为默认值,不依赖 /school/grading 的真实请求失败后回退
vi.mock('@/shared/hooks/useGrading', async () => {
  const { DEFAULT_GRADING } = await import('@/shared/lib/grades')
  return { useGrading: () => DEFAULT_GRADING }
})

const profile: StudentProfile = {
  id: 's1',
  mk: 'S0001',
  name: '王小一',
  class_id: 'c1',
  enrollment_id: 'e1',
}

const pr = (over: Partial<ParentOfStudent>): ParentOfStudent => ({
  link_id: 'l1',
  user_id: 'u1',
  name: '王妈妈',
  relation: '母亲',
  phone: '13800000001',
  is_primary: true,
  status: 'active',
  account_status: 'active',
  shared_account: false,
  must_change_password: false,
  ...over,
})

function mount(ui: React.ReactElement, perms: ClassPerm[] = ['parent.manage']) {
  vi.mocked(classroomApi.summary).mockResolvedValue({
    my_perms: perms,
    today: '2026-11-02',
    timezone: 'Asia/Shanghai',
  } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/x?student=s1']}>
        {ui}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...utils }
}

const fill = (phone: string, name: string) => {
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: phone } })
  fireEvent.change(screen.getByLabelText('称呼'), { target: { value: name } })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(parentLinksApi.list).mockResolvedValue([pr({})])
  vi.mocked(studentsApi.detail).mockResolvedValue(profile as never)
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: ['parent.manage'] } as never)
})

it('drawer hides the 家长 tab without parent.manage and shows it with', async () => {
  const first = mount(<StudentProfileDrawer studentId="s1" />, ['comment.read'])
  await screen.findByRole('tab', { name: '概览' })
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.queryByRole('tab', { name: '家长' })).not.toBeInTheDocument()
  first.unmount()
  mount(<StudentProfileDrawer studentId="s1" />, ['parent.manage'])
  expect(await screen.findByRole('tab', { name: '家长' })).toBeInTheDocument()
})

it('lists parents with badges', async () => {
  vi.mocked(parentLinksApi.list).mockResolvedValue([
    pr({}),
    pr({
      link_id: 'l2',
      name: '王爷爷',
      relation: '祖辈',
      phone: '13800000002',
      is_primary: false,
      status: 'readonly',
      account_status: 'frozen',
      must_change_password: true,
    }),
  ])
  mount(<ParentsTab profile={profile} />)
  const items = await screen.findAllByRole('listitem')
  expect(within(items[0]).getByText('王妈妈')).toBeInTheDocument()
  expect(within(items[0]).getByText('主家长')).toBeInTheDocument()
  expect(within(items[0]).getByText('13800000001')).toBeInTheDocument()
  expect(within(items[1]).getByText('已毕业 / 已离校')).toBeInTheDocument()
  expect(within(items[1]).getByText('已停用')).toBeInTheDocument()
  expect(within(items[1]).getByText('未首次登录')).toBeInTheDocument()
  expect(within(items[1]).queryByText('主家长')).not.toBeInTheDocument()
})

it('new account shows a one-time password dialog that is gone after closing and reopening', async () => {
  vi.mocked(parentLinksApi.create).mockResolvedValue({
    parent: pr({ link_id: 'l9', phone: '13800000009' }),
    temp_password: 'Abc12345',
  })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const log = vi.spyOn(console, 'log')
  const { client, unmount } = mount(<ParentsTab profile={profile} />)
  await screen.findByText('王妈妈')
  fill('13800000009', ' 张爸爸 ')
  fireEvent.change(screen.getByLabelText('关系'), { target: { value: '父亲' } })
  fireEvent.click(screen.getByRole('button', { name: '添加家长' }))
  await waitFor(() =>
    expect(parentLinksApi.create).toHaveBeenCalledWith('s1', {
      phone: '13800000009',
      name: '张爸爸',
      relation: '父亲',
    }),
  )
  const dlg = await screen.findByRole('dialog')
  expect(dlg).toHaveTextContent(
    '家长账号已建好,登录名 13800000009,临时密码 Abc12345。请当面或电话告诉家长,关闭后无法再次查看。',
  )
  fireEvent.click(within(dlg).getByRole('button', { name: '复制' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Abc12345'))
  // 密码不进 query 缓存、storage、console
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain('Abc12345')
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    ),
  ).not.toContain('Abc12345')
  expect(JSON.stringify({ ...localStorage })).not.toContain('Abc12345')
  expect(log).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText(/Abc12345/)).not.toBeInTheDocument()
  unmount()
  mount(<ParentsTab profile={profile} />)
  await screen.findByText('王妈妈')
  expect(screen.queryByText(/Abc12345/)).not.toBeInTheDocument()
})

it('binding to an existing account toasts and shows no dialog', async () => {
  vi.mocked(parentLinksApi.create).mockResolvedValue({ parent: pr({}), temp_password: null })
  mount(<ParentsTab profile={profile} />)
  await screen.findByText('王妈妈')
  fill('13800000003', '李阿姨')
  fireEvent.click(screen.getByRole('button', { name: '添加家长' }))
  expect(
    await screen.findByText('该手机号已有账号,已绑定到这个孩子,家长用原来的密码登录'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('shows the backend message on 409', async () => {
  vi.mocked(parentLinksApi.create).mockRejectedValue(
    new ApiError(409, 'PHONE_TAKEN_INACTIVE', '这个手机号的账号已停用,请联系信息中心'),
  )
  mount(<ParentsTab profile={profile} />)
  await screen.findByText('王妈妈')
  fill('13800000004', '赵')
  fireEvent.click(screen.getByRole('button', { name: '添加家长' }))
  expect(await screen.findByText('这个手机号的账号已停用,请联系信息中心')).toBeInTheDocument()
})

it('disables reset for shared accounts with a hint', async () => {
  vi.mocked(parentLinksApi.list).mockResolvedValue([pr({ shared_account: true })])
  mount(<ParentsTab profile={profile} />)
  const btn = await screen.findByRole('button', { name: '重置密码' })
  expect(btn).toBeDisabled()
  expect(screen.getByText('该账号也是教职工账号,请联系信息中心重置')).toBeInTheDocument()
})

it('disables adding at 4 parents and says why', async () => {
  vi.mocked(parentLinksApi.list).mockResolvedValue(
    [1, 2, 3, 4].map((i) => pr({ link_id: `l${i}`, is_primary: i === 1, name: `家长${i}` })),
  )
  mount(<ParentsTab profile={profile} />)
  await screen.findByText('家长4')
  expect(screen.getByRole('button', { name: '添加家长' })).toBeDisabled()
  expect(screen.getByText('每个孩子最多 4 位家长')).toBeInTheDocument()
})

it('sets primary, unlinks after confirm, and resets via the one-time dialog', async () => {
  vi.mocked(parentLinksApi.list).mockResolvedValue([
    pr({}),
    pr({ link_id: 'l2', name: '王爷爷', is_primary: false, phone: '13800000002' }),
  ])
  vi.mocked(parentLinksApi.setPrimary).mockResolvedValue([])
  vi.mocked(parentLinksApi.unlink).mockResolvedValue(undefined)
  vi.mocked(parentLinksApi.resetPassword).mockResolvedValue({ temp_password: 'Zz98765' })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  mount(<ParentsTab profile={profile} />)
  await screen.findByText('王爷爷')
  const second = screen.getAllByRole('listitem')[1]
  fireEvent.click(within(second).getByRole('button', { name: '设为主家长' }))
  await waitFor(() => expect(parentLinksApi.setPrimary).toHaveBeenCalledWith('l2'))
  fireEvent.click(within(second).getByRole('button', { name: '解绑' }))
  expect(confirmSpy).toHaveBeenCalledWith('解绑后这位家长将看不到该学生')
  expect(parentLinksApi.unlink).not.toHaveBeenCalled()
  confirmSpy.mockReturnValue(true)
  fireEvent.click(within(second).getByRole('button', { name: '解绑' }))
  await waitFor(() => expect(parentLinksApi.unlink).toHaveBeenCalledWith('l2'))
  fireEvent.click(within(second).getByRole('button', { name: '重置密码' }))
  await waitFor(() => expect(parentLinksApi.resetPassword).toHaveBeenCalledWith('l2'))
  expect(await screen.findByRole('dialog')).toHaveTextContent('临时密码 Zz98765')
  confirmSpy.mockRestore()
})
