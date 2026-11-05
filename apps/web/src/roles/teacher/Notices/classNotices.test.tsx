import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classesApi } from '@/shared/api/classes'
import { classNoticesApi } from '@/shared/api/classNotices'
import { noticesApi } from '@/shared/api/notices'
import { Toaster } from '@/shared/components/Toast'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { NoticeSent } from '@/shared/types/admin'
import ClassNoticesPage from './ClassNoticesPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classNotices', () => ({ classNoticesApi: { list: vi.fn(), send: vi.fn(), recall: vi.fn() } }))
vi.mock('@/shared/api/notices', () => ({ noticesApi: { acks: vi.fn(), exportAcks: vi.fn() } }))

const sent = (over: Partial<NoticeSent> = {}): NoticeSent => ({
  id: 'n1', title: '周五春游', content: '带水杯', target_label: '三年二班家长',
  created_at: '2026-11-04T01:00:00Z', recalled_at: null, recipients: 30, read: 12,
  audience: 'parents', ack: { kind: 'none' }, ack_deadline: null, acked: 0, students_without_parent: 0, ...over,
})

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ClassNoticesPage /><Toaster /></MemoryRouter>
  </QueryClientProvider>,
)

const fill = () => {
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '周五春游' } })
  fireEvent.change(screen.getByLabelText('正文'), { target: { value: '带水杯' } })
}
const clickSend = () => fireEvent.click(screen.getByRole('button', { name: '发送' }))

beforeEach(() => {
  vi.clearAllMocks()
  useTeacherStore.setState({ classId: 'c1' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ id: 'c1', name: '三年二班' } as never] })
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [], total: 0 })
})
afterEach(cleanup)

it('fixes the audience to the whole class parents, using the class name', async () => {
  renderPage()
  expect(await screen.findByText('三年二班全体家长')).toBeInTheDocument()
  expect(classNoticesApi.list).toHaveBeenCalledWith('c1', 1)
  expect(await screen.findByText('还没有发出过通知')).toBeInTheDocument()
})

it('sends, refreshes the list, resets the composer and warns about students without a parent', async () => {
  vi.mocked(classNoticesApi.send).mockResolvedValue(sent({ recipients: 28, students_without_parent: 2 }))
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [sent()], total: 1 })
  clickSend()
  await waitFor(() => expect(classNoticesApi.send).toHaveBeenCalledWith('c1', {
    title: '周五春游', content: '带水杯', ack: { kind: 'none' }, ack_deadline: null,
  }))
  expect(await screen.findByText('另有 2 名学生还没有绑定家长,他们收不到')).toBeInTheDocument()
  expect(await screen.findByText('已发给 28 位家长')).toBeInTheDocument()
  expect(await screen.findByText('周五春游', { selector: 'li *' })).toBeInTheDocument()
  expect(screen.getByLabelText('标题')).toHaveValue('')
  expect(screen.getByLabelText('正文')).toHaveValue('')
  expect(screen.getByRole('radio', { name: '不要回执' })).toBeChecked()
})

it('does not warn when every student has a parent', async () => {
  vi.mocked(classNoticesApi.send).mockResolvedValue(sent())
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  clickSend()
  await screen.findByText('已发给 30 位家长')
  expect(screen.queryByText(/还没有绑定家长/)).toBeNull()
})

it('submits a normalized ack', async () => {
  vi.mocked(classNoticesApi.send).mockResolvedValue(sent())
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  fireEvent.click(screen.getByRole('radio', { name: '单选' }))
  fireEvent.change(screen.getByLabelText('选项 1'), { target: { value: ' 参加 ' } })
  fireEvent.change(screen.getByLabelText('选项 2'), { target: { value: '不参加' } })
  clickSend()
  await waitFor(() => expect(classNoticesApi.send).toHaveBeenCalledWith('c1', expect.objectContaining({
    ack: { kind: 'choice', options: ['参加', '不参加'], allow_note: false }, ack_deadline: null,
  })))
})

it('blocks sending when choice options are not enough', async () => {
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  fireEvent.click(screen.getByRole('radio', { name: '单选' }))
  fireEvent.change(screen.getByLabelText('选项 1'), { target: { value: '参加' } })
  clickSend()
  expect((await screen.findAllByText('至少要 2 个选项')).length).toBeGreaterThan(0)
  expect(classNoticesApi.send).not.toHaveBeenCalled()
  expect(screen.getByLabelText('标题')).toHaveValue('周五春游')
})

it('blocks sending when the deadline is in the past', async () => {
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  fireEvent.click(screen.getByRole('radio', { name: '已知晓' }))
  fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '2020-01-01T10:00' } })
  clickSend()
  expect((await screen.findAllByText('截止时间要晚于现在')).length).toBeGreaterThan(0)
  expect(classNoticesApi.send).not.toHaveBeenCalled()
})

it('shows the API error and keeps the draft', async () => {
  vi.mocked(classNoticesApi.send).mockRejectedValue(new ApiError(400, 'BAD_REQUEST', '标题太长'))
  renderPage()
  await screen.findByText('三年二班全体家长')
  fill()
  clickSend()
  expect(await screen.findByRole('alert')).toHaveTextContent('标题太长')
  expect(screen.getByLabelText('标题')).toHaveValue('周五春游')
})

it('shows progress and recalls, then refreshes the list', async () => {
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [sent({ ack: { kind: 'confirm' }, acked: 5 })], total: 1 })
  vi.mocked(classNoticesApi.recall).mockResolvedValue(sent({ recalled_at: '2026-11-04T02:00:00Z' }))
  renderPage()
  const item = (await screen.findByText('周五春游', { selector: 'li *' })).closest('li')!
  expect(within(item).getByText('已读 12 / 30')).toBeInTheDocument()
  expect(within(item).getByText('回执 5 / 30')).toBeInTheDocument()
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [sent({ recalled_at: '2026-11-04T02:00:00Z' })], total: 1 })
  fireEvent.click(within(item).getByRole('button', { name: '撤回 周五春游' }))
  await waitFor(() => expect(classNoticesApi.recall).toHaveBeenCalledWith('c1', 'n1'))
  expect(await within(item).findByText('已撤回')).toBeInTheDocument()
  expect(classNoticesApi.list).toHaveBeenCalledTimes(2)
})

it('opens the ack stats dialog on demand', async () => {
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [sent({ ack: { kind: 'confirm' } })], total: 1 })
  vi.mocked(noticesApi.acks).mockReturnValue(new Promise(() => {}))
  renderPage()
  await screen.findByText('周五春游', { selector: 'li *' })
  expect(noticesApi.acks).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看回执 周五春游' }))
  expect(await screen.findByRole('dialog', { name: '回执统计' })).toBeInTheDocument()
  expect(noticesApi.acks).toHaveBeenCalledWith('n1')
})

it('paginates the sent list', async () => {
  vi.mocked(classNoticesApi.list).mockResolvedValue({ items: [sent()], total: 45 })
  renderPage()
  await screen.findByText('周五春游', { selector: 'li *' })
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(classNoticesApi.list).toHaveBeenCalledWith('c1', 2))
})
