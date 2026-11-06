import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { preferencesApi, type PreferencesWithOnboarded } from '@/shared/api/preferences'
import { useAuthStore } from '@/shared/stores/auth'
import WelcomeDialog from './WelcomeDialog'

vi.mock('@/shared/api/preferences', () => ({ preferencesApi: { get: vi.fn(), save: vi.fn() } }))

const base: PreferencesWithOnboarded = {
  teacher_figure: 'female',
  idle_animation: true,
  review_reasons: [{ text: '积极发言', delta: 1 }],
  onboarded: {},
}

// 模拟后端:GET 返回当前状态,PUT 按 R7 合并 onboarded 的键
let server: PreferencesWithOnboarded

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderDialog(client = newClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <WelcomeDialog />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

const settled = (client: QueryClient, status: 'success' | 'error') =>
  waitFor(() => expect(client.getQueryState(['preferences'])?.status).toBe(status))

beforeEach(() => {
  vi.resetAllMocks()
  server = { ...base, onboarded: {} }
  vi.mocked(preferencesApi.get).mockImplementation(async () => server)
  vi.mocked(preferencesApi.save).mockImplementation(async (p) => {
    server = { ...server, ...p, onboarded: { ...server.onboarded, ...p.onboarded } }
    return server
  })
  useAuthStore.setState({
    accessToken: 'at',
    refreshToken: 'rt',
    user: {
      id: 'u1',
      display_name: '王老师',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})

afterEach(cleanup)

it('welcome shows once', async () => {
  // Review Focus #3:状态存后端,换浏览器 / 清缓存都不再出现
  const first = renderDialog()
  const dialog = await screen.findByRole('dialog', { name: '你好,王老师' })
  expect(within(dialog).getByText('先选一个你的形象,它会站在教室讲台上')).toBeInTheDocument()
  expect(within(dialog).getByText('教室:点名、点评、排座')).toBeInTheDocument()
  expect(within(dialog).getByText(/^成绩与 AI:/)).toBeInTheDocument()
  expect(within(dialog).getByText(/^家长与通知:/)).toBeInTheDocument()
  expect(
    within(dialog).getByText('你的班级已经由学校配置好,点「开始」进入教室'),
  ).toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: '开始' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledTimes(1))
  expect(vi.mocked(preferencesApi.save).mock.calls[0][0]).toEqual({
    teacher_figure: 'female',
    idle_animation: true,
    review_reasons: base.review_reasons,
    onboarded: { teacher: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
  })
  // 同一会话里的缓存也更新了(教室页共用 ['preferences'])
  await waitFor(() =>
    expect(
      first.client.getQueryData<PreferencesWithOnboarded>(['preferences'])?.onboarded,
    ).toHaveProperty('teacher'),
  )
  first.unmount()

  // 新浏览器 / 清缓存:新的 QueryClient 再进来,后端说已完成 → 不弹
  const second = renderDialog()
  await settled(second.client, 'success')
  expect(preferencesApi.get).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('dialog')).toBeNull()
  second.unmount()

  // 后端一开始就标了完成(例如在别的电脑上点过)→ 不弹
  server = { ...base, onboarded: { teacher: '2026-11-01T01:00:00Z' } }
  const third = renderDialog()
  await settled(third.client, 'success')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(preferencesApi.save).toHaveBeenCalledTimes(1)
})

it('picks figure', async () => {
  const { client } = renderDialog()
  const dialog = await screen.findByRole('dialog', { name: '你好,王老师' })
  // 复用教室的讲台人物:两张卡片各画一个
  expect(dialog.querySelector('[data-figure="female"]')).not.toBeNull()
  expect(dialog.querySelector('[data-figure="male"]')).not.toBeNull()
  const female = within(dialog).getByRole('button', { name: '女老师' })
  const male = within(dialog).getByRole('button', { name: '男老师' })
  expect(female).toHaveAttribute('aria-pressed', 'true')
  expect(male).toHaveAttribute('aria-pressed', 'false')

  fireEvent.click(male)
  expect(male).toHaveAttribute('aria-pressed', 'true')
  expect(female).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledTimes(1))
  const body = vi.mocked(preferencesApi.save).mock.calls[0][0]
  expect(body).toEqual({
    teacher_figure: 'male',
    idle_animation: true,
    review_reasons: base.review_reasons,
  })
  // 选形象不算完成:对话框还开着,onboarded 没动
  expect(screen.getByRole('dialog', { name: '你好,王老师' })).toBeInTheDocument()
  expect(server.onboarded).toEqual({})
  // 教室页共用的缓存立即换成新形象
  await waitFor(() =>
    expect(client.getQueryData<PreferencesWithOnboarded>(['preferences'])?.teacher_figure).toBe(
      'male',
    ),
  )
})

it('closing counts as done', async () => {
  renderDialog()
  const dialog = await screen.findByRole('dialog', { name: '你好,王老师' })
  fireEvent.click(within(dialog).getByRole('button', { name: '男老师' }))
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledTimes(1))

  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledTimes(2))
  // 关闭 = 完成,并带上刚选的形象
  expect(vi.mocked(preferencesApi.save).mock.calls[1][0]).toEqual({
    teacher_figure: 'male',
    idle_animation: true,
    review_reasons: base.review_reasons,
    onboarded: { teacher: expect.any(String) },
  })
  expect(server.onboarded?.teacher).toBeDefined()
})

it('does not show when preferences fail', async () => {
  vi.mocked(preferencesApi.get).mockRejectedValue(new Error('boom'))
  const { client } = renderDialog()
  await settled(client, 'error')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(preferencesApi.save).not.toHaveBeenCalled()
})

it('does not show on an old backend without the onboarded field', async () => {
  server = {
    teacher_figure: base.teacher_figure,
    idle_animation: base.idle_animation,
    review_reasons: base.review_reasons,
  }
  const { client } = renderDialog()
  await settled(client, 'success')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(preferencesApi.save).not.toHaveBeenCalled()
})
