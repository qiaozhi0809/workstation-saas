import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { classroomApi } from '@/shared/api/classroom'
import { growthApi } from '@/shared/api/growth'
import { reviewsApi } from '@/shared/api/reviews'
import { Toaster } from '@/shared/components/Toast'
import type { ClassPerm } from '@/shared/types/classroom'
import type { GrowthRecord } from '@/shared/types/growth'
import type { Review } from '@/shared/types/review'
import type { StudentProfile } from '@/shared/types/student'
import GrowthTab from './GrowthTab'
import OverviewTab from './OverviewTab'
import ReviewDetail from './ReviewDetail'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/growth', () => ({ growthApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() } }))
vi.mock('@/shared/api/reviews', () => ({ reviewsApi: { listForStudent: vi.fn(), revokeItem: vi.fn(), summary: vi.fn() } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn().mockResolvedValue({ exams: [] }) } }))
vi.mock('@/shared/api/attendance', () => ({ attendanceApi: { month: vi.fn().mockResolvedValue({ month: '2026-11', items: [] }) } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { setClassRole: vi.fn() } }))

const profile: StudentProfile = { id: 's1', mk: 'S0001', name: '王小一', class_id: 'c1', enrollment_id: 'e1' }

const rec = (over: Partial<GrowthRecord>): GrowthRecord => ({
  id: 'g1', type: '表扬', date: '2026-10-30', content: '主动帮同学补课', academic_year_name: '2026-2027',
  class_name: '七(1)班', current_year: true, created_by_name: '李老师', can_delete: true, created_at: '2026-10-30T08:00:00Z', ...over,
})
const review = (over: Partial<Review>): Review => ({
  id: 'r1', op_id: 'o1', enrollment_id: 'e1', category: 'individual', reason_text: '作业认真', score_delta: 2,
  subject: null, given_at: '2026-10-30T02:15:00Z', given_by_me: true, student_name: '王小一', transferred: false, ...over,
})

function setup(ui: React.ReactElement, perms: ClassPerm[]) {
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: perms, today: '2026-11-02', timezone: 'Asia/Shanghai' } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><MemoryRouter>{ui}<Toaster /></MemoryRouter></QueryClientProvider>)
  return { invalidate }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(growthApi.list).mockResolvedValue({ items: [] })
  vi.mocked(growthApi.create).mockResolvedValue(rec({}))
  vi.mocked(growthApi.remove).mockResolvedValue(undefined)
  vi.mocked(reviewsApi.listForStudent).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(reviewsApi.revokeItem).mockResolvedValue({ review_id: 'r1', revoked: 1 })
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-10-26', items: [] })
})

it('adds a record with Enter and keeps composition input', async () => {
  const { invalidate } = setup(<GrowthTab profile={profile} />, ['growth.read', 'growth.write'])
  const input = await screen.findByLabelText('记录内容')
  fireEvent.change(input, { target: { value: '家访了解情况' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(growthApi.create).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(growthApi.create).toHaveBeenCalledWith('s1', { type: '表扬', date: '2026-11-02', content: '家访了解情况' }))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['growth', 's1'] }))
  await waitFor(() => expect(input).toHaveValue(''))
})

it('shows past-year records as read-only with their year and class', async () => {
  vi.mocked(growthApi.list).mockResolvedValue({
    items: [rec({ id: 'g2', current_year: false, can_delete: false, academic_year_name: '2025-2026', class_name: '六(2)班', content: '获奖了', type: '获奖' })],
  })
  setup(<GrowthTab profile={profile} />, ['growth.read', 'growth.write'])
  expect(await screen.findByText('获奖了')).toBeInTheDocument()
  expect(screen.getByText('2025-2026 · 六(2)班')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
})

it('deletes after confirm only when allowed', async () => {
  vi.mocked(growthApi.list).mockResolvedValue({
    items: [rec({}), rec({ id: 'g3', content: '别人的记录', can_delete: false })],
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  setup(<GrowthTab profile={profile} />, ['growth.read', 'growth.write'])
  await screen.findByText('别人的记录')
  const buttons = screen.getAllByRole('button', { name: '删除' })
  expect(buttons).toHaveLength(1)
  fireEvent.click(buttons[0])
  expect(confirmSpy).toHaveBeenCalledWith('删除这条成长记录?')
  expect(growthApi.remove).not.toHaveBeenCalled()
  confirmSpy.mockReturnValue(true)
  fireEvent.click(buttons[0])
  await waitFor(() => expect(growthApi.remove).toHaveBeenCalledWith('g1'))
  confirmSpy.mockRestore()
})

it('hides the form without growth.write', async () => {
  vi.mocked(growthApi.list).mockResolvedValue({ items: [rec({})] })
  setup(<GrowthTab profile={profile} />, ['growth.read'])
  expect(await screen.findByText('主动帮同学补课')).toBeInTheDocument()
  expect(screen.queryByLabelText('记录内容')).not.toBeInTheDocument()
})

it('shows a permission note without growth.read', async () => {
  setup(<GrowthTab profile={profile} />, [])
  expect(await screen.findByText('你在本班没有查看成长记录的权限')).toBeInTheDocument()
  expect(growthApi.list).not.toHaveBeenCalled()
})

it('shows an empty state without records', async () => {
  setup(<GrowthTab profile={profile} />, ['growth.read'])
  expect(await screen.findByText('还没有成长记录')).toBeInTheDocument()
})

it('lists 40 reviews and revokes only my own', async () => {
  vi.mocked(reviewsApi.listForStudent).mockResolvedValue({
    items: [review({}), review({ id: 'r2', reason_text: '上课走神', score_delta: -1, given_by_me: false, given_at: '2026-10-29T03:00:00Z' })],
    next_cursor: null,
  })
  const { invalidate } = setup(<ReviewDetail profile={profile} />, ['review.read', 'review.write'])
  expect(await screen.findByText('作业认真')).toBeInTheDocument()
  expect(reviewsApi.listForStudent).toHaveBeenCalledWith('c1', 'e1', 40)
  expect(screen.getByText('10-30 10:15')).toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()
  expect(screen.getByText('-1')).toBeInTheDocument()
  const buttons = screen.getAllByRole('button', { name: '撤销' })
  expect(buttons).toHaveLength(1)
  fireEvent.click(buttons[0])
  await waitFor(() => expect(reviewsApi.revokeItem).toHaveBeenCalledWith('c1', 'r1'))
  expect(await screen.findByText('已撤销')).toBeInTheDocument()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student-reviews', 'c1', 'e1'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['review-summary', 'c1'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reviews', 'c1', 'feed'] })
})

it('shows 暂无点评 when there are none', async () => {
  setup(<ReviewDetail profile={profile} />, ['review.read'])
  expect(await screen.findByText('暂无点评')).toBeInTheDocument()
})

it('shows the latest three records on the overview and links to the tab', async () => {
  vi.mocked(growthApi.list).mockResolvedValue({
    items: [1, 2, 3, 4].map((n) => rec({ id: `g${n}`, content: `记录${n}` })),
  })
  setup(<OverviewTab student={profile} />, ['growth.read'])
  const block = (await screen.findByText('最近成长记录')).closest('section')!
  await within(block).findByText('记录3')
  expect(within(block).queryByText('记录4')).not.toBeInTheDocument()
  expect(within(block).getByRole('button', { name: '查看全部' })).toBeInTheDocument()
})

it('hides the overview block without records', async () => {
  setup(<OverviewTab student={profile} />, ['growth.read'])
  await waitFor(() => expect(growthApi.list).toHaveBeenCalled())
  expect(screen.queryByText('最近成长记录')).not.toBeInTheDocument()
})
