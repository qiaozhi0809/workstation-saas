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

it('marks reviews of students no longer in the class as transferred out', async () => {
  // 名单只含在读学生;转出学生的点评记录还在,后端 feed 只给 enrollment_id
  vi.mocked(reviewsApi.list).mockResolvedValue({ next_cursor: null, items: [
    review({ id: 'r9', enrollment_id: 'e9', given_at: '2026-11-02T02:05:00Z' }),
  ] })
  setup()
  expect(await screen.findByText('（已转出） 积极发言 +1 · 我 · 10:05')).toBeInTheDocument()
  expect(screen.queryByText(/全班/)).toBeNull()
})

it('colours the attendance bar like the map chips', async () => {
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null, items: [
    { enrollment_id: 'e1', status: 'leave', reason: null, marked_at: '' },
    { enrollment_id: 'e2', status: 'absent', reason: null, marked_at: '' },
    { enrollment_id: 'e3', status: 'late', reason: null, marked_at: '' },
  ] })
  setup()
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  await within(rail).findByText('实到 1 / 3')
  const bar = (status: string) => rail.querySelector(`[data-status="${status}"]`)
  expect(bar('leave')).toHaveClass('bg-warning')
  expect(bar('absent')).toHaveClass('bg-destructive')
  expect(bar('late')).toHaveClass('bg-info')
})

it('renders the rail as an overlay below 1100px and closes it with Escape', async () => {
  window.innerWidth = 1024
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '概况栏' }))
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  expect(within(rail).getByRole('button', { name: '收起概况栏' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('complementary', { name: '班级概况' })).not.toBeInTheDocument()
})

it('moves focus into the overlay rail and returns it to the opener on close', async () => {
  window.innerWidth = 1024
  setup()
  const opener = await screen.findByRole('button', { name: '概况栏' })
  fireEvent.click(opener)
  const close = await screen.findByRole('button', { name: '收起概况栏' })
  expect(close).toHaveFocus()
  fireEvent.click(close)
  expect(screen.queryByRole('complementary', { name: '班级概况' })).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
  expect(opener).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(opener)
  await screen.findByRole('complementary', { name: '班级概况' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('complementary', { name: '班级概况' })).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

it('closes the overlay rail when going to roll call', async () => {
  window.innerWidth = 1024
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '概况栏' }))
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  fireEvent.click(await within(rail).findByRole('button', { name: '去点名' }))
  expect(screen.getByRole('tab', { name: '考勤' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('complementary', { name: '班级概况' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '概况栏' })).toHaveFocus()
})

it('does not close the inline rail on Escape', async () => {
  window.innerWidth = 1280
  setup()
  await screen.findByRole('complementary', { name: '班级概况' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('complementary', { name: '班级概况' })).toBeInTheDocument()
})

it('keeps the inline rail without a close button at 1280px', async () => {
  window.innerWidth = 1280
  setup()
  const rail = await screen.findByRole('complementary', { name: '班级概况' })
  expect(within(rail).queryByRole('button', { name: '收起概况栏' })).not.toBeInTheDocument()
})
