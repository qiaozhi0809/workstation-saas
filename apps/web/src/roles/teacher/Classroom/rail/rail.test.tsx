import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { reviewsApi } from '@/shared/api/reviews'
import { todosApi } from '@/shared/api/todos'
import { defaultApiMocks, review, setup } from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

const width = window.innerWidth
beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
  window.innerWidth = 1280
})
afterEach(() => { window.innerWidth = width })

it('summarises today and attendance and jumps to roll call', async () => {
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null,
    items: [{ enrollment_id: 'e2', status: 'leave', reason: null, marked_at: '' }] })
  setup()
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  expect(within(rail).getByText('11月2日 星期一')).toBeInTheDocument()
  expect(within(rail).getByText('2026-2027 学年 · 第 10 周')).toBeInTheDocument()
  expect(await within(rail).findByText('实到 2 / 3')).toBeInTheDocument()
  fireEvent.click(within(rail).getByRole('button', { name: '去点名' }))
  expect(screen.getByRole('tab', { name: '考勤' })).toHaveAttribute('aria-selected', 'true')
})

it('lists birthdays in the next 7 days', async () => {
  setup()
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  expect(await within(rail).findByText('明天')).toBeInTheDocument()
  expect(within(rail).getByText('9 岁')).toBeInTheDocument()
  expect(within(rail).queryByText('李小二')).toBeNull()
})

it('adds a todo on Enter but not while composing', async () => {
  setup()
  const input = await screen.findByPlaceholderText('添加一件要做的事')
  fireEvent.change(input, { target: { value: '收回执' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(todosApi.create).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(todosApi.create).toHaveBeenCalledWith('收回执'))
  await waitFor(() => expect(input).toHaveValue(''))
})

it('does not submit a blank todo', async () => {
  setup()
  const input = await screen.findByPlaceholderText('添加一件要做的事')
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(todosApi.create).not.toHaveBeenCalled()
})

it('toggles and deletes a todo', async () => {
  vi.mocked(todosApi.list).mockResolvedValue({ items: [
    { id: 't1', content: '收回执', done: false, created_at: '2026-11-02T01:00:00Z' },
  ] })
  setup()
  fireEvent.click(await screen.findByRole('checkbox', { name: '收回执' }))
  await waitFor(() => expect(todosApi.update).toHaveBeenCalledWith('t1', { done: true }))
  fireEvent.click(screen.getByRole('button', { name: '删除 收回执' }))
  await waitFor(() => expect(todosApi.remove).toHaveBeenCalledWith('t1'))
})

it('shows recent reviews without naming other teachers', async () => {
  vi.mocked(reviewsApi.list).mockResolvedValue({ next_cursor: null, items: [
    review({ given_by_me: false, given_at: '2026-11-02T02:05:00Z' }),
  ] })
  setup()
  expect(await screen.findByText('王小一 积极发言 +1 · 老师 · 10:05')).toBeInTheDocument()
  expect(reviewsApi.list).toHaveBeenCalledWith('c1', { limit: 6 })
})
