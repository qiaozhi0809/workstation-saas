import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { examsApi } from '@/shared/api/exams'
import type { GradebookExam } from '@/shared/types/grades'
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
vi.mock('@/shared/api/exams')

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

const openPanel = async () => fireEvent.click(await screen.findByRole('button', { name: '待办与点评' }))

it('opens 待办与点评 as a side panel with only the todo and review sections, and returns focus on close', async () => {
  setup()
  const opener = await screen.findByRole('button', { name: '待办与点评' })
  expect(opener).toHaveAttribute('title', '待办与点评')
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  opener.focus()
  fireEvent.click(opener)
  const dlg = await screen.findByRole('dialog', { name: '待办与点评' })
  expect(within(dlg).getByRole('heading', { name: '待办' })).toBeInTheDocument()
  expect(within(dlg).getByRole('heading', { name: '最近点评' })).toBeInTheDocument()
  expect(within(dlg).queryByText('今日考勤')).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '待办与点评' })).toBeNull())
  await waitFor(() => expect(opener).toHaveFocus())
})

it('leaves out the review feed without review.read (todos stay)', async () => {
  setup({ perms: ['attendance.read'] })
  await openPanel()
  const dlg = await screen.findByRole('dialog', { name: '待办与点评' })
  expect(within(dlg).getByRole('heading', { name: '待办' })).toBeInTheDocument()
  expect(within(dlg).queryByRole('heading', { name: '最近点评' })).toBeNull()
  expect(reviewsApi.list).not.toHaveBeenCalled()
})

it('adds a todo on Enter but not while composing', async () => {
  setup()
  await openPanel()
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
  await openPanel()
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
  await openPanel()
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
  await openPanel()
  expect(await screen.findByText('王小一 积极发言 +1 · 老师 · 10:05')).toBeInTheDocument()
  expect(reviewsApi.list).toHaveBeenCalledWith('c1', { limit: 6 })
})

it('marks reviews of students no longer in the class as transferred out', async () => {
  // 名单只含在读学生;转出学生的点评记录还在,后端 feed 带 student_name / transferred
  vi.mocked(reviewsApi.list).mockResolvedValue({ next_cursor: null, items: [
    review({ id: 'r9', enrollment_id: 'e9', student_name: '陈转出', transferred: true, given_at: '2026-11-02T02:05:00Z' }),
  ] })
  setup()
  await openPanel()
  expect(await screen.findByText('陈转出（已转出） 积极发言 +1 · 我 · 10:05')).toBeInTheDocument()
  expect(screen.queryByText(/全班/)).toBeNull()
})

const exam = (id: string, date: string, scores: Record<string, number>): GradebookExam => ({
  id, name: `考试${id}`, exam_type: '月考', date, subjects: [{ name: '语文', full: 100 }],
  created_by_me: true, progress: { entered: 3, total: 3 },
  scores: Object.fromEntries(Object.entries(scores).map(([e, v]) => [e, { 语文: v }])),
})

it('shows the latest exam summary in the side panel', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [
    exam('x1', '2026-09-20', { e1: 50, e2: 60, e3: 70 }),
    exam('x2', '2026-10-20', { e1: 95, e2: 85, e3: 55 }),
  ] })
  setup()
  await openPanel()
  const dlg = await screen.findByRole('dialog', { name: '待办与点评' })
  expect(await within(dlg).findByRole('heading', { name: '最近考试' })).toBeInTheDocument()
  expect(await within(dlg).findByText('考试x2')).toBeInTheDocument()
  expect(within(dlg).getByText('平均 78.3/100')).toBeInTheDocument()
  expect(within(dlg).getByText('及格率 67% · 优秀率 67%')).toBeInTheDocument()
  expect(within(dlg).getByRole('img', { name: '历次平均得分率' })).toBeInTheDocument()
  expect(within(dlg).getByRole('link', { name: '查看分析' })).toHaveAttribute('href', '/teacher/analysis?exam=x2')
})

it('says there are no exam scores yet, and hides the section without exam.read', async () => {
  setup()
  await openPanel()
  const dlg = await screen.findByRole('dialog', { name: '待办与点评' })
  expect(await within(dlg).findByText('还没有考试成绩')).toBeInTheDocument()
})

it('does not render the exam section without exam.read', async () => {
  setup({ perms: ['attendance.read'] })
  await openPanel()
  const dlg = await screen.findByRole('dialog', { name: '待办与点评' })
  expect(within(dlg).queryByRole('heading', { name: '最近考试' })).toBeNull()
  expect(examsApi.gradebook).not.toHaveBeenCalled()
})
