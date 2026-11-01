import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { reviewsApi } from '@/shared/api/reviews'
import * as csv from '@/shared/lib/csv'
import type { Review } from '@/shared/types/review'
import { defaultApiMocks, review, setup } from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

it('posts an individual review with a fresh op id', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', {
    op_id: expect.stringMatching(/^[0-9a-f-]{36}$/), category: 'individual',
    enrollment_ids: ['e1'], reason_text: '积极发言', score_delta: 1,
  }))
  expect(await screen.findByText('+1')).toBeInTheDocument()
})

it('posts once when a reason is double-clicked', async () => {
  let resolve!: (v: { items: Review[] }) => void
  vi.mocked(reviewsApi.create).mockReturnValue(new Promise((r) => { resolve = r }))
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  const btn = await screen.findByRole('button', { name: '积极发言 +1' })
  fireEvent.click(btn)
  fireEvent.click(btn)
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  expect(btn).toBeDisabled()
  expect(screen.getByRole('button', { name: '作业优秀 +1' })).toBeDisabled()
  await act(async () => { resolve({ items: [review()] }) })
  await waitFor(() => expect(screen.queryByRole('button', { name: '积极发言 +1' })).not.toBeInTheDocument())
  expect(reviewsApi.create).toHaveBeenCalledTimes(1)
})

it('gives the whole class +1 and explains an empty class', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '全班 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    category: 'whole_class', reason_text: '全班表现好', score_delta: 1 })))
  expect(vi.mocked(reviewsApi.create).mock.calls[0][1]).not.toHaveProperty('enrollment_ids')
  vi.mocked(reviewsApi.create).mockRejectedValue(new ApiError(400, 'NO_TARGETS', 'x'))
  fireEvent.click(screen.getByRole('button', { name: '全班 +1' }))
  expect(await screen.findByText('今天全班都请假了')).toBeInTheDocument()
})

it('revokes from the undo toast', async () => {
  vi.mocked(reviewsApi.create).mockResolvedValue({ items: [review({ op_id: 'op1' })] })
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
  await waitFor(() => expect(reviewsApi.revoke).toHaveBeenCalledWith('c1', 'op1'))
})

it('asks for a subject when the teacher teaches several here', async () => {
  setup({ mode: '点评', subjects: ['物理', '化学'], perms: ['attendance.read', 'review.read', 'review.write'] })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.change(await screen.findByLabelText('科目'), { target: { value: '化学' } })
  fireEvent.click(screen.getByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({ subject: '化学' })))
})

it('ranks students and groups on the leaderboard', async () => {
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-11-02', items: [
    { enrollment_id: 'e1', total: 5, week: 1, plus_count: 5, minus_count: 0 },
    { enrollment_id: 'e2', total: 5, week: 0, plus_count: 6, minus_count: 1 },
    { enrollment_id: 'e3', total: 2, week: 0, plus_count: 2, minus_count: 0 },
  ] })
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '积分榜' }))
  const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1)
  expect(rows.map((r) => r.textContent)).toEqual(['1王小一550', '1李小二561', '3张小三220'])
  expect(screen.getByText('第 1 组')).toBeInTheDocument()
  expect(screen.getByText('10')).toBeInTheDocument()
})

it('submits a custom reason and closes on Escape', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '李小二' }))
  const ok = await screen.findByRole('button', { name: '确定' })
  expect(ok).toBeDisabled()
  fireEvent.change(screen.getByLabelText('理由'), { target: { value: '帮同学' } })
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '0' } })
  expect(ok).toBeDisabled()
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '-3' } })
  fireEvent.click(ok)
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    enrollment_ids: ['e2'], reason_text: '帮同学', score_delta: -3 })))
  fireEvent.click(await screen.findByRole('button', { name: '张小三' }))
  fireEvent.click(await screen.findByRole('button', { name: '+1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenLastCalledWith('c1', expect.objectContaining({
    enrollment_ids: ['e3'], reason_text: '表现好', score_delta: 1 })))
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  await screen.findByRole('button', { name: '确定' })
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('button', { name: '确定' })).not.toBeInTheDocument())
})

it('overlays score badges only in review mode', async () => {
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-11-02', items: [
    { enrollment_id: 'e1', total: 9, week: 9, plus_count: 9, minus_count: 0 },
    { enrollment_id: 'e2', total: -2, week: -2, plus_count: 0, minus_count: 2 },
  ] })
  setup({ mode: '点评' })
  expect(await screen.findByText('+9')).toBeInTheDocument()
  expect(screen.getByText('-2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  await waitFor(() => expect(screen.queryByText('+9')).not.toBeInTheDocument())
})

it('exports every page of reviews', async () => {
  const dl = vi.spyOn(csv, 'downloadText').mockImplementation(() => {})
  vi.mocked(reviewsApi.list)
    .mockResolvedValueOnce({ items: [review({ id: 'a' })], next_cursor: 'k1' })
    .mockResolvedValueOnce({ items: [review({ id: 'b', enrollment_id: 'e2' })], next_cursor: null })
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '导出点评' }))
  await waitFor(() => expect(dl).toHaveBeenCalledWith('三年二班-点评.csv', expect.stringContaining('李小二')))
  expect(reviewsApi.list).toHaveBeenNthCalledWith(1, 'c1', { cursor: undefined, limit: 200 })
  expect(reviewsApi.list).toHaveBeenNthCalledWith(2, 'c1', { cursor: 'k1', limit: 200 })
  dl.mockRestore()
})

it('hides the popover and write buttons without review.write', async () => {
  setup({ mode: '点评', perms: ['attendance.read', 'review.read'] })
  expect(await screen.findByRole('button', { name: '积分榜' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '导出点评' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '全班 +1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '王小一' })).not.toBeInTheDocument()
})
