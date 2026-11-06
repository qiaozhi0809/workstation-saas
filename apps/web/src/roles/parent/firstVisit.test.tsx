import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { preferencesApi, type PreferencesWithOnboarded } from '@/shared/api/preferences'
import FirstVisit from './FirstVisit'

vi.mock('@/shared/api/preferences', () => ({ preferencesApi: { get: vi.fn(), save: vi.fn() } }))

const base: PreferencesWithOnboarded = {
  teacher_figure: 'female',
  idle_animation: true,
  review_reasons: [{ text: '积极发言', delta: 1 }],
  onboarded: {},
}
const COPY = '这里可以看到孩子的今日出勤、点评、成绩和成长记录;学校的通知会出现在「通知」里'
const card = () => screen.queryByRole('region', { name: '首次使用提示' })

// 模拟后端:GET 返回当前状态,PUT 按 R7 合并 onboarded 的键
let server: PreferencesWithOnboarded

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <FirstVisit />
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
})

afterEach(cleanup)

it('first visit card dismisses', async () => {
  const first = renderCard()
  const region = await screen.findByRole('region', { name: '首次使用提示' })
  expect(region).toHaveTextContent(COPY)

  fireEvent.click(within(region).getByRole('button', { name: '知道了' }))
  await waitFor(() => expect(card()).toBeNull())
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledTimes(1))
  // 发偏好整体,onboarded 只带 parent 这一个键(服务端按键合并,R7)
  expect(vi.mocked(preferencesApi.save).mock.calls[0][0]).toEqual({
    teacher_figure: 'female',
    idle_animation: true,
    review_reasons: base.review_reasons,
    onboarded: { parent: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
  })
  first.unmount()

  // 再进来(新缓存):后端已记完成 → 不再出现
  const second = renderCard()
  await settled(second.client, 'success')
  expect(card()).toBeNull()
})

it('stays hidden when already done, when preferences fail, or on an old backend', async () => {
  // 老师兼家长:teacher 键不影响 parent 这边,parent 已完成才算完成
  server = {
    ...base,
    onboarded: { teacher: '2026-11-01T01:00:00Z', parent: '2026-11-02T01:00:00Z' },
  }
  const done = renderCard()
  await settled(done.client, 'success')
  expect(card()).toBeNull()
  done.unmount()

  server = { ...base, onboarded: { teacher: '2026-11-01T01:00:00Z' } }
  const teacherOnly = renderCard()
  expect(await screen.findByRole('region', { name: '首次使用提示' })).toBeInTheDocument()
  teacherOnly.unmount()

  vi.mocked(preferencesApi.get).mockRejectedValue(new Error('boom'))
  const failed = renderCard()
  await settled(failed.client, 'error')
  expect(card()).toBeNull()
  failed.unmount()

  vi.mocked(preferencesApi.get).mockResolvedValue({
    teacher_figure: base.teacher_figure,
    idle_animation: base.idle_animation,
    review_reasons: base.review_reasons,
  })
  const legacy = renderCard()
  await settled(legacy.client, 'success')
  expect(card()).toBeNull()
  expect(preferencesApi.save).not.toHaveBeenCalled()
})
