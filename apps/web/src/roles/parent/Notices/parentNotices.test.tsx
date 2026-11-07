import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LoginPage from '@/auth/LoginPage'
import { noticesApi } from '@/shared/api/notices'
import { parentApi } from '@/shared/api/parent'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import type { InboxItem } from '@/shared/types/admin'
// testkit 里 vi.mock 了 @/shared/api/preferences(壳里的首次说明卡):要先于 ParentLayout import(L305)
import { child, mockWidth, setParentUser, today } from '../testkit'
import ParentLayout, { ParentIndex } from '../ParentLayout'
import TodayPage from '../Today/TodayPage'
import ParentNoticesPage from './ParentNoticesPage'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), today: vi.fn(), profile: vi.fn(), saveContacts: vi.fn() },
}))
vi.mock('@/shared/api/notices', () => ({
  noticesApi: { inbox: vi.fn(), read: vi.fn(), readAll: vi.fn(), ack: vi.fn() },
}))

const h = vi.hoisted(() => ({
  made: [] as { opts: { onEvent(e: unknown): void }; start: () => void; stop: () => void }[],
}))
vi.mock('@/shared/realtime/client', async (orig) => ({
  ...(await orig<typeof import('@/shared/realtime/client')>()),
  createRealtimeClient: (opts: { onEvent(e: unknown): void }) => {
    const c = { opts, start: vi.fn(), stop: vi.fn() }
    h.made.push(c)
    return c
  },
}))

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'n1',
  title: '周五春游',
  content: '带水杯',
  from_name: '陈老师',
  created_at: '2026-11-04T01:00:00Z',
  read_at: null,
  recalled: false,
  ack: { kind: 'none' },
  ack_deadline: null,
  my_ack: null,
  students_detail: [{ name: '王小一', class_name: '三年二班' }],
  can_ack: false,
  ack_block_reason: null,
  ...over,
})
const inbox = (
  items: InboxItem[],
  unread = items.filter((i) => !i.read_at && !i.recalled).length,
) => ({ items, total: items.length, unread })

const push = (e: unknown) =>
  act(async () => {
    h.made[0].opts.onEvent(e)
  })

function renderAt(entry = '/parent/notices?child=s1') {
  const router = createMemoryRouter(
    [
      {
        path: '/parent',
        element: (
          <ProtectedRoute context="parent">
            <ParentLayout />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <ParentIndex /> },
          { path: 'today', element: <TodayPage /> },
          { path: 'notices', element: <ParentNoticesPage /> },
        ],
      },
      { path: '/login', element: <LoginPage /> },
    ],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  h.made.length = 0
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue([
    child(),
    child({ student_id: 's2', name: '王小二' }),
  ])
  vi.mocked(parentApi.today).mockResolvedValue(today())
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([]))
  vi.mocked(noticesApi.read).mockResolvedValue(undefined)
  vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
})
afterEach(cleanup)

const tab = () =>
  within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: /^通知/ })

it('parent shell logs out on session.revoked', async () => {
  const router = renderAt()
  await screen.findByText('还没有通知')
  expect(h.made).toHaveLength(1)
  await act(async () => {
    h.made[0].opts.onEvent({ type: 'session.revoked' })
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(router.state.location.pathname).toBe('/login')
  expect(screen.getByText('你的账号已被停用')).toBeInTheDocument()
})

it('adds a 通知 tab that keeps ?child= and shows the unread count', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([item(), item({ id: 'n2', title: '期中安排' })]),
  )
  renderAt('/parent/today?child=s2')
  const link = await screen.findByRole('link', { name: '通知 2 条未读' })
  expect(link).toHaveAttribute('href', '/parent/notices?child=s2')
  expect(link.className).toMatch(/min-h-\[44px\]/)
})

it('caps the badge at 99+ and hides it at zero', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue({ items: [], total: 0, unread: 120 })
  renderAt()
  expect(await screen.findByText('99+')).toBeInTheDocument()
  cleanup()
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([]))
  renderAt()
  await screen.findByText('还没有通知')
  expect(tab()).toHaveAccessibleName('通知')
})

it('notice.new bumps the badge by one and toasts once', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([item()]))
  renderAt()
  await screen.findByRole('link', { name: '通知 1 条未读' })
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([item(), item({ id: 'n2', title: '期中安排' })]),
  )
  await push({
    type: 'notice.new',
    id: 'n2',
    title: '期中安排',
    from_name: '陈老师',
    created_at: '2026-11-04T02:00:00Z',
  })
  expect(await screen.findByRole('link', { name: '通知 2 条未读' })).toBeInTheDocument()
  expect(screen.getAllByText('新通知:期中安排')).toHaveLength(1)
})

it('notice.recalled and reconnected refetch the inbox', async () => {
  renderAt()
  await screen.findByText('还没有通知')
  const n = () => vi.mocked(noticesApi.inbox).mock.calls.length
  const before = n()
  await push({ type: 'notice.recalled', id: 'n1' })
  await waitFor(() => expect(n()).toBe(before + 1))
  await push({ type: 'reconnected' })
  await waitFor(() => expect(n()).toBe(before + 2))
})

it('lists notices of all children, bold when unread, with the children named', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([
      item(),
      item({
        id: 'n2',
        title: '班会',
        read_at: '2026-11-04T03:00:00Z',
        students_detail: [{ name: '王小二', class_name: '五年一班' }],
      }),
    ]),
  )
  renderAt('/parent/notices?child=s1')
  const unread = (await screen.findByText('周五春游')).closest('button')!
  expect(unread.className).toMatch(/font-semibold/)
  expect(within(unread).getByText(/王小一\(三年二班\)/)).toBeInTheDocument()
  const read = screen.getByText('班会').closest('button')!
  expect(read.className).not.toMatch(/font-semibold/)
  expect(within(read).getByText(/王小二\(五年一班\)/)).toBeInTheDocument()
  expect(read.className).toMatch(/min-h-\[44px\]/)
})

it('names the children with the class snapshot taken when the notice was sent (L87)', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([
      // 发送时孩子在二年二班(升学后现在是三年二班):显示快照,不显示现在的班
      item({
        students_detail: [
          { name: '王小一', class_name: '二年二班' },
          { name: '王小二', class_name: null },
        ],
      }),
    ]),
  )
  renderAt('/parent/notices?child=s1')
  const row = (await screen.findByText('周五春游')).closest('button')!
  expect(within(row).getByText(/涉及:王小一\(二年二班\)、王小二$/)).toBeInTheDocument()
  expect(within(row).queryByText(/三年二班/)).toBeNull()
})

it('shows 系统 for system notices', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([item({ from_name: null, title: '账号安全提醒' })]),
  )
  renderAt()
  const btn = (await screen.findByText('账号安全提醒')).closest('button')!
  expect(within(btn).getByText(/^系统 · /)).toBeInTheDocument()
})

it('shows the empty state', async () => {
  renderAt()
  expect(await screen.findByText('还没有通知')).toBeInTheDocument()
})

it('marks as read on open and shows the content', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([item()]))
  renderAt()
  const row = (await screen.findByText('周五春游')).closest('button')!
  fireEvent.click(row)
  await waitFor(() => expect(noticesApi.read).toHaveBeenCalledWith('n1'))
  expect(screen.getByText('带水杯')).toBeInTheDocument()
  // 已读是就地写进缓存的(L280),不靠重取收件箱
  await waitFor(() => expect(row.className).not.toMatch(/font-semibold/))
  expect(noticesApi.inbox).toHaveBeenCalledTimes(1)
})

it('does not mark an already read notice again', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([item({ read_at: '2026-11-04T05:00:00Z' })]))
  renderAt()
  fireEvent.click(await screen.findByText('周五春游'))
  expect(screen.getByText('带水杯')).toBeInTheDocument()
  expect(noticesApi.read).not.toHaveBeenCalled()
})

it('tags a notice that waits for an ack, and the tag goes away after acking', async () => {
  const waiting = item({ ack: { kind: 'confirm' }, can_ack: true, read_at: '2026-11-04T05:00:00Z' })
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([waiting]))
  renderAt()
  const row = (await screen.findByText('周五春游')).closest('button')!
  expect(within(row).getByText('待回执')).toBeInTheDocument()
  fireEvent.click(row)
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([{ ...waiting, my_ack: { choice: null, note: null, acked_at: '2026-11-04T06:00:00Z' } }]),
  )
  fireEvent.click(screen.getByRole('button', { name: '已知晓' }))
  await waitFor(() =>
    expect(noticesApi.ack).toHaveBeenCalledWith('n1', { choice: null, note: null }),
  )
  await waitFor(() =>
    expect(
      within(screen.getByText('周五春游').closest('button')!).queryByText('待回执'),
    ).toBeNull(),
  )
})

it('does not tag notices that need no ack, were acked, or cannot be acked', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([
      item({ id: 'a', title: '甲' }),
      item({
        id: 'b',
        title: '乙',
        ack: { kind: 'confirm' },
        can_ack: true,
        my_ack: { choice: null, note: null, acked_at: '2026-11-04T06:00:00Z' },
      }),
      item({ id: 'c', title: '丙', ack: { kind: 'confirm' }, can_ack: false }),
    ]),
  )
  renderAt()
  await screen.findByText('甲')
  expect(screen.queryByText('待回执')).toBeNull()
})

/** 25 条通知分两页(每页 20):第 1 页 n1–n20,第 2 页 n21–n25;unread 由后端按全量给 */
function twoPages() {
  const all = Array.from({ length: 25 }, (_, i) => item({ id: `n${i + 1}`, title: `通知${i + 1}` }))
  return (page: number) => ({ items: all.slice((page - 1) * 20, page * 20), total: 25, unread: 23 })
}

it('loads the next inbox page from a 加载更多 button and keeps the badge on the full unread count (L90)', async () => {
  const pages = twoPages()
  vi.mocked(noticesApi.inbox).mockImplementation(async (page) => pages(page))
  renderAt('/parent/notices?child=s1')
  await screen.findByText('通知1')
  expect(screen.getByText('通知20')).toBeInTheDocument()
  expect(screen.queryByText('通知21')).toBeNull()
  // 徽标按全量:23 条未读,不是第 1 页里数出来的 20
  expect(tab()).toHaveAccessibleName('通知 23 条未读')
  const more = screen.getByRole('button', { name: '加载更多' })
  expect(
    more.compareDocumentPosition(screen.getByText('通知20')) & Node.DOCUMENT_POSITION_PRECEDING,
  ).toBeTruthy()
  fireEvent.click(more)
  expect(await screen.findByText('通知25')).toBeInTheDocument()
  expect(noticesApi.inbox).toHaveBeenCalledWith(2)
  expect(screen.getByText('通知1')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull())
  expect(tab()).toHaveAccessibleName('通知 23 条未读')
})

it('a notice arriving between pages is not shown twice and does not trigger an extra empty page', async () => {
  const all = Array.from({ length: 25 }, (_, i) => item({ id: `n${i + 1}`, title: `通知${i + 1}` }))
  // 第 1 页取完后来了 n0:第 2 页按位置 21–26 给,开头是第 1 页末尾的 n20
  vi.mocked(noticesApi.inbox).mockImplementation(async (page) =>
    page === 1
      ? { items: all.slice(0, 20), total: 25, unread: 23 }
      : { items: [all[19]!, ...all.slice(20)], total: 26, unread: 24 },
  )
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
  expect(await screen.findByText('通知25')).toBeInTheDocument()
  expect(screen.getAllByText('通知20')).toHaveLength(1)
  await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull())
  expect(noticesApi.inbox).toHaveBeenCalledTimes(2)
})

it('has no 加载更多 when the inbox fits in one page', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([item(), item({ id: 'n2', title: '班会' })]))
  renderAt()
  await screen.findByText('班会')
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
})

it('reports a failed next page and lets the parent try again', async () => {
  const pages = twoPages()
  vi.mocked(noticesApi.inbox)
    .mockImplementationOnce(async (page) => pages(page))
    .mockRejectedValueOnce(new Error('x'))
    .mockImplementation(async (page) => pages(page))
  renderAt()
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
  expect(await screen.findByText('加载更多失败')).toBeInTheDocument()
  expect(screen.getByText('通知1')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
  expect(await screen.findByText('通知25')).toBeInTheDocument()
})

/** 两页都加载好:n1–n25,收件箱请求过第 1、2 页各一次 */
async function openTwoPages() {
  const pages = twoPages()
  vi.mocked(noticesApi.inbox).mockImplementation(async (page) => pages(page))
  renderAt('/parent/notices?child=s1')
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
  await screen.findByText('通知25')
  expect(noticesApi.inbox).toHaveBeenCalledTimes(2)
}

it('mark read does not refetch pages', async () => {
  await openTwoPages()
  const row = screen.getByText('通知1').closest('button')!
  fireEvent.click(row)
  await waitFor(() => expect(noticesApi.read).toHaveBeenCalledWith('n1'))
  // 就地改缓存(L280):这条变已读、全量未读数减一;两页都还在,没有按已加载页数逐页重取
  await waitFor(() => expect(tab()).toHaveAccessibleName('通知 22 条未读'))
  expect(row.className).not.toMatch(/font-semibold/)
  expect(screen.getByText('通知25')).toBeInTheDocument()
  expect(noticesApi.inbox).toHaveBeenCalledTimes(2)
})

it('new notice refetches first page only', async () => {
  await openTwoPages()
  // 来了 n0:服务端第 1 页现在是 n0 + n1–n19,总数 26,未读 24
  const all = [
    item({ id: 'n0', title: '通知0' }),
    ...Array.from({ length: 25 }, (_, i) => item({ id: `n${i + 1}`, title: `通知${i + 1}` })),
  ]
  vi.mocked(noticesApi.inbox).mockImplementation(async (page) => ({
    items: all.slice((page - 1) * 20, page * 20),
    total: 26,
    unread: 24,
  }))
  await push({
    type: 'notice.new',
    id: 'n0',
    title: '通知0',
    from_name: '陈老师',
    created_at: '2026-11-04T02:00:00Z',
  })
  expect(await screen.findByText('通知0')).toBeInTheDocument()
  // 只重取第 1 页(L280):不再逐页重取已加载的两页;后页丢弃,"加载更多"重新出现
  expect(noticesApi.inbox).toHaveBeenCalledTimes(3)
  expect(noticesApi.inbox).toHaveBeenLastCalledWith(1)
  expect(screen.getByText('通知19')).toBeInTheDocument()
  expect(screen.queryByText('通知25')).toBeNull()
  expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument()
  expect(tab()).toHaveAccessibleName('通知 24 条未读')
})

it('shows 此通知已撤回 and no ack form for a recalled notice', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(
    inbox([item({ recalled: true, content: null, ack: { kind: 'confirm' }, can_ack: false })]),
  )
  renderAt()
  await screen.findByText('周五春游')
  expect(screen.getAllByText('此通知已撤回').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /周五春游/ })).toBeNull() // 已撤回的条目不是按钮
  fireEvent.click(screen.getByText('周五春游'))
  expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
  expect(noticesApi.read).not.toHaveBeenCalled()
  expect(screen.queryByText('待回执')).toBeNull()
})
