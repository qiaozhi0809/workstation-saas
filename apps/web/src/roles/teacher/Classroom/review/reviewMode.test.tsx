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
vi.mock('@/shared/api/exams')

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

it('posts an individual review with a fresh op id', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  const btn = await screen.findByRole('button', { name: '积极发言 +1' })
  // 同一批里连点两次:此时按钮还没来得及被禁用,只有同步守卫能拦住第二次
  act(() => { btn.click(); btn.click() })
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  expect(btn).toBeDisabled()
  expect(screen.getByRole('button', { name: '作业优秀 +1' })).toBeDisabled()
  await act(async () => { resolve({ items: [review()] }) })
  await waitFor(() => expect(screen.queryByRole('button', { name: '积极发言 +1' })).not.toBeInTheDocument())
  expect(reviewsApi.create).toHaveBeenCalledTimes(1)
})

it('posts the whole-class bonus once when double-clicked', async () => {
  let resolve!: (v: { items: Review[] }) => void
  vi.mocked(reviewsApi.create).mockReturnValue(new Promise((r) => { resolve = r }))
  setup({ mode: '点评' })
  const btn = await screen.findByRole('button', { name: '全班 +1' })
  act(() => { btn.click(); btn.click() })
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  expect(btn).toBeDisabled()
  await act(async () => { resolve({ items: [review()] }) })
  await waitFor(() => expect(btn).toBeEnabled())
  expect(reviewsApi.create).toHaveBeenCalledTimes(1)
})

it('gives the whole class +1 and explains an empty class', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '全班 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    category: 'whole_class', reason_text: '全班表现好', score_delta: 1 })))
  expect(vi.mocked(reviewsApi.create).mock.calls[0][1]).not.toHaveProperty('enrollment_ids')
  await screen.findByRole('button', { name: '撤销' })
  await waitFor(() => expect(screen.getByRole('button', { name: '全班 +1' })).toBeEnabled())
  vi.mocked(reviewsApi.create).mockRejectedValue(new ApiError(400, 'NO_TARGETS', 'x'))
  fireEvent.click(screen.getByRole('button', { name: '全班 +1' }))
  expect(await screen.findByText('今天全班都请假了')).toBeInTheDocument()
})

it('reuses the op id when retrying after an ambiguous failure', async () => {
  vi.mocked(reviewsApi.create).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  await screen.findByText('Failed to fetch')
  await waitFor(() => expect(screen.getByRole('button', { name: '积极发言 +1' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(2))
  const ids = vi.mocked(reviewsApi.create).mock.calls.map((c) => c[1].op_id)
  expect(ids[1]).toBe(ids[0])
  // 成功后清除:再点同一条理由是新的一次点评
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(3))
  expect(vi.mocked(reviewsApi.create).mock.calls[2][1].op_id).not.toBe(ids[0])
})

it('uses a fresh op id for a different payload or after a 4xx', async () => {
  vi.mocked(reviewsApi.create)
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new ApiError(400, 'BAD', 'bad request'))
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  await screen.findByText('Failed to fetch')
  await waitFor(() => expect(screen.getByRole('button', { name: '作业优秀 +1' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '作业优秀 +1' }))
  await screen.findByText('bad request')
  await waitFor(() => expect(screen.getByRole('button', { name: '作业优秀 +1' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '作业优秀 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(3))
  const ids = vi.mocked(reviewsApi.create).mock.calls.map((c) => c[1].op_id)
  expect(new Set(ids).size).toBe(3)
})

it('closes the popover on stage pointerdown but not inside it', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  const dialog = await screen.findByRole('dialog', { name: '点评 王小一' })
  fireEvent.pointerDown(within(dialog).getByLabelText('理由'))
  expect(screen.getByRole('dialog', { name: '点评 王小一' })).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByRole('button', { name: /^李小二，/ }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '点评 王小一' })).not.toBeInTheDocument())
})

it('removes the float after 1400ms', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  // 记录 1400ms 的定时器,手动触发,避免假时钟卡住 waitFor
  const real = globalThis.setTimeout
  const floatTimers: (() => void)[] = []
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 1400) { floatTimers.push(fn); return 0 as unknown as ReturnType<typeof setTimeout> }
    return real(fn, ms, ...rest)
  }) as typeof setTimeout)
  try {
    fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
    await waitFor(() => expect(floatTimers).toHaveLength(1))
    expect(await screen.findByText('+1')).toBeInTheDocument()
    act(() => { floatTimers[0]() })
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  } finally { spy.mockRestore() }
})

it('revokes from the undo toast', async () => {
  vi.mocked(reviewsApi.create).mockResolvedValue({ items: [review({ op_id: 'op1' })] })
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(await screen.findByRole('button', { name: '积极发言 +1' }))
  fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
  await waitFor(() => expect(reviewsApi.revoke).toHaveBeenCalledWith('c1', 'op1'))
})

it('asks for a subject when the teacher teaches several here', async () => {
  setup({ mode: '点评', subjects: ['物理', '化学'], perms: ['attendance.read', 'review.read', 'review.write'] })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
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

it('shows the leaderboard as a modal and closes it with the dialog close button', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: '积分榜' }))
  const dialog = await screen.findByRole('dialog', { name: '积分榜' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '积分榜' })).not.toBeInTheDocument())
})

it('submits a custom reason and closes on Escape', async () => {
  setup({ mode: '点评' })
  fireEvent.click(await screen.findByRole('button', { name: /^李小二，/ }))
  const ok = await screen.findByRole('button', { name: '确定' })
  expect(ok).toBeDisabled()
  fireEvent.change(screen.getByLabelText('理由'), { target: { value: '帮同学' } })
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '0' } })
  expect(ok).toBeDisabled()
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '-3' } })
  fireEvent.click(ok)
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    enrollment_ids: ['e2'], reason_text: '帮同学', score_delta: -3 })))
  fireEvent.click(await screen.findByRole('button', { name: /^张小三，/ }))
  fireEvent.click(await screen.findByRole('button', { name: '+1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenLastCalledWith('c1', expect.objectContaining({
    enrollment_ids: ['e3'], reason_text: '表现好', score_delta: 1 })))
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
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
  expect(screen.queryByRole('button', { name: /^王小一，/ })).not.toBeInTheDocument()
})

const SUBJECT_TEACHER = ['attendance.read', 'review.read', 'review.write'] as const

it('requires a subject for a multi-subject subject teacher, defaulting to the first and remembering the choice', async () => {
  setup({ mode: '点评', subjects: ['物理', '化学'], perms: [...SUBJECT_TEACHER] })
  fireEvent.click(await screen.findByRole('button', { name: '全班 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    category: 'whole_class', subject: '物理' })))
  await waitFor(() => expect(screen.getByRole('button', { name: '全班 +1' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  const select = await screen.findByLabelText('科目')
  expect(within(select).queryByRole('option', { name: '不指定' })).toBeNull()
  expect(select).toHaveValue('物理')
  fireEvent.change(select, { target: { value: '化学' } })
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(await screen.findByLabelText('科目')).toHaveValue('化学')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '全班 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenLastCalledWith('c1', expect.objectContaining({
    category: 'whole_class', subject: '化学' })))
})

it('lets a homeroom teacher who teaches several subjects leave the subject out', async () => {
  setup({ mode: '点评', subjects: ['物理', '化学'] })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  const select = await screen.findByLabelText('科目')
  expect(select).toHaveValue('')
  expect(within(select).getByRole('option', { name: '不指定' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  expect(vi.mocked(reviewsApi.create).mock.calls[0][1]).not.toHaveProperty('subject')
})

it('omits the subject when a subject teacher teaches one subject here', async () => {
  setup({ mode: '点评', subjects: ['物理'], perms: [...SUBJECT_TEACHER] })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  await screen.findByRole('dialog', { name: '点评 王小一' })
  expect(screen.queryByLabelText('科目')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '积极发言 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  expect(vi.mocked(reviewsApi.create).mock.calls[0][1]).not.toHaveProperty('subject')
})
