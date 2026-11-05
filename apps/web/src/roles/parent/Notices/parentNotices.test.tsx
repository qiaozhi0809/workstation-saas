import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LoginPage from '@/auth/LoginPage'
import { noticesApi } from '@/shared/api/notices'
import { parentApi } from '@/shared/api/parent'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import type { InboxItem } from '@/shared/types/admin'
import ParentLayout, { ParentIndex } from '../ParentLayout'
import TodayPage from '../Today/TodayPage'
import { child, mockWidth, setParentUser, today } from '../testkit'
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
  students: ['王小一'],
  can_ack: false,
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
      item({ students: ['王小一'] }),
      item({ id: 'n2', title: '班会', read_at: '2026-11-04T03:00:00Z', students: ['王小二'] }),
    ]),
  )
  renderAt('/parent/notices?child=s1')
  const unread = (await screen.findByText('周五春游')).closest('button')!
  expect(unread.className).toMatch(/font-semibold/)
  expect(within(unread).getByText(/王小一/)).toBeInTheDocument()
  const read = screen.getByText('班会').closest('button')!
  expect(read.className).not.toMatch(/font-semibold/)
  expect(within(read).getByText(/王小二/)).toBeInTheDocument()
  expect(read.className).toMatch(/min-h-\[44px\]/)
})

it('shows the empty state', async () => {
  renderAt()
  expect(await screen.findByText('还没有通知')).toBeInTheDocument()
})

it('marks as read on open and shows the content', async () => {
  vi.mocked(noticesApi.inbox).mockResolvedValue(inbox([item()]))
  renderAt()
  fireEvent.click(await screen.findByText('周五春游'))
  await waitFor(() => expect(noticesApi.read).toHaveBeenCalledWith('n1'))
  expect(screen.getByText('带水杯')).toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(noticesApi.inbox).mock.calls.length).toBeGreaterThan(1))
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
