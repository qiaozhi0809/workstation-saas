import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noticesApi } from '@/shared/api/notices'
import { Toaster } from '@/shared/components/Toast'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import type { RealtimeEvent } from '@/shared/realtime/client'
import { useAuthStore } from '@/shared/stores/auth'
import type { Inbox, InboxItem } from '@/shared/types/admin'
import NoticeBell from './NoticeBell'

const h = vi.hoisted(() => ({ made: [] as { opts: { onEvent(e: unknown): void } }[] }))
vi.mock('@/shared/realtime/client', async (orig) => ({
  ...(await orig<typeof import('@/shared/realtime/client')>()),
  createRealtimeClient: (opts: { onEvent(e: unknown): void }) => {
    const c = { opts, start: vi.fn(), stop: vi.fn() }
    h.made.push(c)
    return c
  },
}))
vi.mock('@/shared/api/notices', () => ({ noticesApi: { inbox: vi.fn(), read: vi.fn(), readAll: vi.fn(), ack: vi.fn() } }))

const item = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id, title: `通知${id}`, content: `正文${id}`, from_name: '陈校长',
  created_at: '2026-11-04T01:00:00Z', read_at: null, recalled: false,
  ack: { kind: 'none' }, ack_deadline: null, my_ack: null, students: [], can_ack: false, ...over,
})

// 一份可变的"服务端状态":各个 mock 读写它,这样失效重取后能看到变化
let server: Inbox
const recount = () => { server.unread = server.items.filter((i) => !i.read_at && !i.recalled).length }
const emit = (e: RealtimeEvent) => act(async () => { h.made.at(-1)!.opts.onEvent(e) })

const renderBell = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <RealtimeProvider><NoticeBell /><Toaster /></RealtimeProvider>
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  vi.clearAllMocks()
  h.made.length = 0
  server = { items: [item('1'), item('2'), item('3', { read_at: '2026-11-04T02:00:00Z' })], total: 3, unread: 2 }
  vi.mocked(noticesApi.inbox).mockImplementation(async () => structuredClone(server))
  vi.mocked(noticesApi.read).mockImplementation(async (id) => {
    const it = server.items.find((i) => i.id === id)
    if (it) it.read_at = '2026-11-04T03:00:00Z'
    recount()
  })
  vi.mocked(noticesApi.readAll).mockImplementation(async () => {
    server.items.forEach((i) => { if (!i.read_at) i.read_at = '2026-11-04T03:00:00Z' })
    recount()
  })
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r',
    user: { id: 'u', display_name: '王老师', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
})
afterEach(() => { cleanup(); useAuthStore.getState().logout() })

describe('通知铃铛', () => {
  it('shows the unread count in the badge and in the accessible name', async () => {
    renderBell()
    const bell = await screen.findByRole('button', { name: '通知,2 条未读' })
    expect(within(bell).getByText('2')).toBeInTheDocument()
    expect(noticesApi.inbox).toHaveBeenCalledWith(1)
  })

  it('shows no badge when everything is read', async () => {
    server = { items: [item('1', { read_at: '2026-11-04T02:00:00Z' })], total: 1, unread: 0 }
    renderBell()
    const bell = await screen.findByRole('button', { name: '通知,0 条未读' })
    expect(within(bell).queryByText(/\d/)).toBeNull()
  })

  it('caps the badge at 99+', async () => {
    server = { ...server, unread: 120 }
    renderBell()
    const bell = await screen.findByRole('button', { name: '通知,120 条未读' })
    expect(within(bell).getByText('99+')).toBeInTheDocument()
  })

  it('bumps the unread count and toasts when a notice.new event arrives', async () => {
    renderBell()
    await screen.findByRole('button', { name: '通知,2 条未读' })
    server.items.unshift(item('4', { title: '放假通知' }))
    server.total = 4
    recount()
    await emit({ type: 'notice.new', id: '4', title: '放假通知', from_name: '陈校长', created_at: '2026-11-04T04:00:00Z' })
    expect(await screen.findByRole('button', { name: '通知,3 条未读' })).toBeInTheDocument()
    expect(screen.getByText('新通知:放假通知')).toBeInTheDocument()
  })

  it('refetches inbox after reconnect', async () => {
    renderBell()
    await screen.findByRole('button', { name: '通知,2 条未读' })
    expect(noticesApi.inbox).toHaveBeenCalledTimes(1)
    server.items.unshift(item('5', { title: '断线期间的通知' }))
    recount()
    await emit({ type: 'reconnected' })
    expect(await screen.findByRole('button', { name: '通知,3 条未读' })).toBeInTheDocument()
    expect(noticesApi.inbox).toHaveBeenCalledTimes(2)
  })

  it('shows 此通知已撤回 after notice.recalled', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    expect(within(list).queryByText('此通知已撤回')).toBeNull()
    server.items[0] = item('1', { content: null, recalled: true })
    recount()
    await emit({ type: 'notice.recalled', id: '1' })
    expect(await within(list).findByText('此通知已撤回')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通知,1 条未读' })).toBeInTheDocument()
  })

  it('opens a notice: shows the content, calls read and lowers the badge', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    const row = within(list).getByRole('button', { name: /通知1/ })
    expect(row).toHaveClass('font-semibold')
    expect(within(list).queryByText('正文1')).toBeNull()
    fireEvent.click(row)
    expect(within(list).getByText('正文1')).toBeInTheDocument()
    await waitFor(() => expect(noticesApi.read).toHaveBeenCalledWith('1'))
    expect(await screen.findByRole('button', { name: '通知,1 条未读' })).toBeInTheDocument()
    await waitFor(() => expect(within(list).getByRole('button', { name: /通知1/ })).not.toHaveClass('font-semibold'))
  })

  it('does not call read again for an already-read notice', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    fireEvent.click(within(list).getByRole('button', { name: /通知3/ }))
    expect(within(list).getByText('正文3')).toBeInTheDocument()
    expect(noticesApi.read).not.toHaveBeenCalled()
  })

  it('marks everything as read', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    fireEvent.click(within(list).getByRole('button', { name: '全部标为已读' }))
    await waitFor(() => expect(noticesApi.readAll).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: '通知,0 条未读' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no notices', async () => {
    server = { items: [], total: 0, unread: 0 }
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,0 条未读' }))
    expect(await screen.findByText('暂无通知')).toBeInTheDocument()
  })

  it('renders a recalled notice as plain text, not a button, and never calls read', async () => {
    server = { items: [item('1', { content: null, recalled: true })], total: 1, unread: 0 }
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,0 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    expect(within(list).getByText('此通知已撤回')).toBeInTheDocument()
    expect(within(list).getByText('通知1')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /通知1/ })).toBeNull()
    expect(noticesApi.read).not.toHaveBeenCalled()
  })

  it('shows no ack form for a notice without ack', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    fireEvent.click(within(list).getByRole('button', { name: /通知1/ }))
    expect(within(list).getByText('正文1')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: '已知晓' })).toBeNull()
  })

  it('shows the ack form (not nested in the title button) and marks 已回执 after submit', async () => {
    server = { items: [item('1', { ack: { kind: 'confirm' }, can_ack: true })], total: 1, unread: 1 }
    vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,1 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    expect(within(list).queryByRole('button', { name: '已知晓' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: /通知1/ }))
    const ackBtn = within(list).getByRole('button', { name: '已知晓' })
    expect(ackBtn.parentElement!.closest('button')).toBeNull()
    // 先等展开引起的标已读与重取落定,再看回执本身是否让铃铛的收件箱重取
    await waitFor(() => expect(noticesApi.read).toHaveBeenCalledWith('1'))
    await waitFor(() => expect(within(screen.getByRole('button', { name: /^通知,/ })).queryByText('1')).toBeNull())
    const before = vi.mocked(noticesApi.inbox).mock.calls.length
    fireEvent.click(ackBtn)
    await waitFor(() => expect(noticesApi.ack).toHaveBeenCalledWith('1', { choice: null, note: null }))
    expect(await within(list).findByText(/已回执/)).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(noticesApi.inbox).mock.calls.length).toBeGreaterThan(before))
  })

  it('keeps each notice\'s ack state separate (key by id)', async () => {
    server = {
      items: [
        item('1', { ack: { kind: 'confirm' }, can_ack: true, my_ack: { choice: null, note: null, acked_at: '2026-11-04T03:00:00Z' } }),
        item('2', { ack: { kind: 'confirm' }, can_ack: true }),
      ], total: 2, unread: 2,
    }
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: '通知,2 条未读' }))
    const list = await screen.findByRole('dialog', { name: '通知' })
    fireEvent.click(within(list).getByRole('button', { name: /通知1/ }))
    expect(within(list).getByText(/已回执/)).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: /通知2/ }))
    expect(within(list).queryByText(/已回执/)).toBeNull()
    expect(within(list).getByRole('button', { name: '已知晓' })).toBeInTheDocument()
  })
})
