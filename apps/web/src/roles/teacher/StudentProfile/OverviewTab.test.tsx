import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { attendanceApi } from '@/shared/api/attendance'
import { examsApi } from '@/shared/api/exams'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { Toaster } from '@/shared/components/Toast'
import type { Gradebook } from '@/shared/types/grades'
import type { ClassPerm } from '@/shared/types/classroom'
import type { StudentProfile } from '@/shared/types/student'
import OverviewTab, { CLASS_ROLE_PRESETS } from './OverviewTab'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { setClassRole: vi.fn() } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn() } }))
vi.mock('@/shared/api/reviews', () => ({ reviewsApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/attendance', () => ({ attendanceApi: { month: vi.fn() } }))
const trendLine = vi.hoisted(() => vi.fn())
const scoreRadar = vi.hoisted(() => vi.fn())
vi.mock('@/shared/components/charts/TrendLine', () => ({
  TrendLine: (props: { label: string }) => { trendLine(props); return <div role="img" aria-label={props.label} /> },
}))
vi.mock('@/shared/components/charts/ScoreRadar', () => ({
  ScoreRadar: (props: { label: string }) => { scoreRadar(props); return <div role="img" aria-label={props.label} /> },
}))

const subjects = [{ name: '语文', full: 100 }, { name: '数学', full: 100 }]
const base = { exam_type: '月考' as const, subjects, created_by_me: true, progress: { entered: 3, total: 3 } }
const book: Gradebook = {
  exams: [
    { ...base, id: 'x1', name: '九月月考', date: '2026-09-20',
      scores: { e1: { 语文: 80, 数学: 70 }, e2: { 语文: 90, 数学: 90 }, e3: { 语文: 50, 数学: 60 } } },
    { ...base, id: 'x2', name: '十月月考', date: '2026-10-25',
      scores: { e1: { 语文: 55, 数学: 85 }, e2: { 语文: 70, 数学: 80 }, e3: { 语文: 90, 数学: 70 } } },
  ],
}

const profile: StudentProfile = { id: 's1', mk: 'S0001', name: '王小一', class_id: 'c1', enrollment_id: 'e1' }

function renderTab({ perms, student, today = '2026-11-02' }: { perms: ClassPerm[]; student: StudentProfile; today?: string }) {
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: perms, today } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><OverviewTab student={student} /><Toaster /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(studentsApi.setClassRole).mockResolvedValue({ enrollment_id: 'e1', class_role: null })
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [] })
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-10-26', items: [] })
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-11', items: [] })
})

it('lets the homeroom teacher set a class role', async () => {
  const { invalidate } = renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: undefined } })
  fireEvent.change(await screen.findByLabelText('职务'), { target: { value: '体育委员' } })
  await waitFor(() => expect(studentsApi.setClassRole).toHaveBeenCalledWith('c1', 'e1', '体育委员'))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student', 's1'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['class-students', 'c1'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student-records', 'c1'] })
  fireEvent.change(screen.getByLabelText('职务'), { target: { value: '' } })
  await waitFor(() => expect(studentsApi.setClassRole).toHaveBeenLastCalledWith('c1', 'e1', null))
})

it('lists 无, the presets, and a current value that is not a preset', async () => {
  renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: '图书管理员' } })
  const select = await screen.findByLabelText('职务')
  const options = within(select).getAllByRole('option').map((o) => o.textContent)
  expect(options).toEqual(['无', ...CLASS_ROLE_PRESETS, '图书管理员'])
  expect(select).toHaveValue('图书管理员')
})

it('shows the class role read-only for other teachers', async () => {
  renderTab({ perms: ['review.write'], student: { ...profile, class_role: '班长' } })
  expect(await screen.findByText('班长')).toBeInTheDocument()
  expect(screen.queryByLabelText('职务')).toBeNull()
})

it('shows 暂无 when read-only and empty', async () => {
  renderTab({ perms: [], student: profile })
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalled())
  expect(screen.getByText('职务').nextElementSibling).toHaveTextContent('暂无')
})

it('reverts the select and toasts the server error on failure', async () => {
  vi.mocked(studentsApi.setClassRole).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '没有权限'))
  renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: '班长' } })
  fireEvent.change(await screen.findByLabelText('职务'), { target: { value: '小组长' } })
  expect(await screen.findByText('没有权限')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('职务')).toHaveValue('班长'))
})

it('shows the latest total, rank change, rate curve and subject radar in the overview', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue(book)
  renderTab({ perms: ['exam.read'], student: profile })
  expect(await screen.findByText('第 3 名')).toBeInTheDocument()
  expect(examsApi.gradebook).toHaveBeenCalledWith('c1')
  expect(screen.getByText('140')).toBeInTheDocument()
  expect(screen.getByText('↓1')).toBeInTheDocument()

  const rate = trendLine.mock.calls.at(-1)![0]
  expect(rate.label).toBe('总分得分率')
  expect(rate.labels).toEqual(['九月月考', '十月月考'])
  expect(rate.domain).toEqual([40, 100])
  expect(rate.endLabel).toBe(true)
  expect(rate.format(70)).toBe('70%')
  expect(rate.format(66.66666666666667)).toBe('67%')
  const me = rate.series.find((x: { key: string }) => x.key === 'me')
  const avg = rate.series.find((x: { key: string }) => x.key === 'avg')
  expect(me.values).toEqual([75, 70])
  expect(avg.muted).toBe(true)
  expect(avg.values[0]).toBeCloseTo(73.33, 1)
  expect(avg.values[1]).toBeCloseTo(75, 1)

  const radar = scoreRadar.mock.calls.at(-1)![0]
  expect(radar.label).toBe('学科画像')
  expect(radar.axes).toEqual(['语文', '数学'])
  expect(radar.series[0].values).toEqual([55, 85])
  expect(radar.series[1].values).toEqual([72, 78])
})

it('drops radar axes the student has no score for and shows ↑ for a climb', async () => {
  const climbed: Gradebook = { exams: [book.exams[0], { ...book.exams[1], scores: {
    e1: { 语文: 95, 数学: null }, e2: { 语文: 40, 数学: 30 }, e3: { 语文: 30, 数学: 30 } } }] }
  vi.mocked(examsApi.gradebook).mockResolvedValue(climbed)
  renderTab({ perms: ['exam.read'], student: profile })
  expect(await screen.findByText('↑1')).toBeInTheDocument()
  expect(scoreRadar.mock.calls.at(-1)![0].axes).toEqual(['语文'])
})

it('does not request the gradebook without exam.read', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue(book)
  renderTab({ perms: ['review.write'], student: profile })
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalled())
  await screen.findByText('职务')
  expect(examsApi.gradebook).not.toHaveBeenCalled()
  expect(screen.queryByText('学科画像')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
})

it('rounds radar values to integers', async () => {
  const frac: Gradebook = { exams: [{ ...base, id: 'x1', name: '期中', date: '2026-10-25',
    subjects: [{ name: '数学', full: 120 }],
    scores: { e1: { 数学: 55 }, e2: { 数学: 100 }, e3: { 数学: 61 } } }] }
  vi.mocked(examsApi.gradebook).mockResolvedValue(frac)
  renderTab({ perms: ['exam.read'], student: profile })
  await waitFor(() => expect(scoreRadar).toHaveBeenCalled())
  const radar = scoreRadar.mock.calls.at(-1)![0]
  expect(radar.series[0].values).toEqual([46])
  expect(radar.series[1].values).toEqual([Math.round(((55 + 100 + 61) / 3 / 120) * 100)])
})

it('renders no score blocks without scores', async () => {
  renderTab({ perms: ['exam.read'], student: profile })
  await waitFor(() => expect(examsApi.gradebook).toHaveBeenCalled())
  expect(screen.queryByText('学科画像')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
})

it('renders no score blocks when the gradebook is forbidden', async () => {
  vi.mocked(examsApi.gradebook).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'))
  renderTab({ perms: ['exam.read'], student: profile })
  await waitFor(() => expect(examsApi.gradebook).toHaveBeenCalled())
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

const kpi = (name: string) => within(screen.getByRole('group', { name: '概况指标' })).getByText(name).parentElement!

it('shows total points and review count with review.read', async () => {
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-10-26', items: [
    { enrollment_id: 'e2', total: 99, week: 1, plus_count: 9, minus_count: 0 },
    { enrollment_id: 'e1', total: -3, week: 0, plus_count: 2, minus_count: 3 },
  ] })
  renderTab({ perms: ['review.read'], student: profile })
  await screen.findByText('点评 5 次')
  expect(reviewsApi.summary).toHaveBeenCalledWith('c1')
  expect(kpi('累计积分')).toHaveTextContent('-3')
})

it('shows 0 points and 0 reviews when the student is not in the summary', async () => {
  renderTab({ perms: ['review.read'], student: profile })
  await screen.findByText('点评 0 次')
  expect(kpi('累计积分')).toHaveTextContent('0')
})

it('hides the points card and skips the request without review.read', async () => {
  renderTab({ perms: ['attendance.read'], student: profile })
  await screen.findByText('本月考勤')
  expect(screen.queryByText('累计积分')).toBeNull()
  expect(reviewsApi.summary).not.toHaveBeenCalled()
})

it('shows 全勤 when the month has no exceptions', async () => {
  renderTab({ perms: ['attendance.read'], student: profile })
  expect(await screen.findByText('全勤')).toBeInTheDocument()
  expect(screen.getByText('11月无请假缺勤迟到')).toBeInTheDocument()
})

it('counts distinct absent days and per-status records for this student only', async () => {
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-11', items: [
    { enrollment_id: 'e1', date: '2026-11-01', status: 'leave' },
    { enrollment_id: 'e1', date: '2026-11-02', status: 'absent' },
    { enrollment_id: 'e1', date: '2026-11-03', status: 'late' },
    { enrollment_id: 'e1', date: '2026-11-04', status: 'late' },
    { enrollment_id: 'e2', date: '2026-11-05', status: 'absent' },
  ] })
  renderTab({ perms: ['attendance.read'], student: profile })
  expect(await screen.findByText('2 天未到')).toBeInTheDocument()
  expect(screen.getByText('请假 1 · 缺勤 1 · 迟到 2')).toBeInTheDocument()
})

it('shows 0 天未到 when there are only late records', async () => {
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-11', items: [
    { enrollment_id: 'e1', date: '2026-11-03', status: 'late' },
  ] })
  renderTab({ perms: ['attendance.read'], student: profile })
  expect(await screen.findByText('0 天未到')).toBeInTheDocument()
  expect(screen.getByText('请假 0 · 缺勤 0 · 迟到 1')).toBeInTheDocument()
  expect(screen.queryByText('全勤')).toBeNull()
})

it('queries the month of summary.today', async () => {
  renderTab({ perms: ['attendance.read'], student: profile, today: '1999-03-31' })
  await waitFor(() => expect(attendanceApi.month).toHaveBeenCalledWith('c1', '1999-03'))
  expect(await screen.findByText('3月无请假缺勤迟到')).toBeInTheDocument()
})

it('refetches the attendance KPI on reopen even within the global staleTime', async () => {
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: ['attendance.read'], today: '2026-11-02' } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const ui = (
    <QueryClientProvider client={client}>
      <MemoryRouter><OverviewTab student={profile} /></MemoryRouter>
    </QueryClientProvider>
  )
  const first = render(ui)
  expect(await screen.findByText('全勤')).toBeInTheDocument()
  first.unmount()
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-11', items: [
    { enrollment_id: 'e1', date: '2026-11-02', status: 'absent' },
  ] })
  render(ui)
  expect(await screen.findByText('1 天未到')).toBeInTheDocument()
})

it('does not show the attendance card without attendance.read', async () => {
  renderTab({ perms: ['review.read'], student: profile })
  await screen.findByText('累计积分')
  expect(screen.queryByText('本月考勤')).toBeNull()
  expect(attendanceApi.month).not.toHaveBeenCalled()
})

it.each([
  ['2026-03-05', '2026-03-05', '就是今天'],
  ['2010-03-08', '2026-03-05', '3 天后'],
  ['2010-01-02', '2026-12-30', '3 天后'],
])('shows birthday %s on %s as %s', async (birthdate, today, hint) => {
  renderTab({ perms: [], student: { ...profile, birthdate }, today })
  expect(await screen.findByText(hint)).toBeInTheDocument()
  const [, m, d] = birthdate.split('-').map(Number)
  expect(kpi('生日')).toHaveTextContent(`${m}月${d}日`)
})

it('shows 未填 without a birthday', async () => {
  renderTab({ perms: [], student: profile })
  expect(await screen.findByText('未填')).toBeInTheDocument()
})

it('shows — while a card is loading or failed, without blocking the others', async () => {
  vi.mocked(reviewsApi.summary).mockRejectedValue(new ApiError(500, 'X', 'no'))
  renderTab({ perms: ['review.read', 'attendance.read'], student: profile })
  expect(await screen.findByText('全勤')).toBeInTheDocument()
  await waitFor(() => expect(kpi('累计积分')).toHaveTextContent('—'))
})
