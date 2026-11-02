import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { Toaster } from '@/shared/components/Toast'
import type { Gradebook } from '@/shared/types/grades'
import type { ClassPerm } from '@/shared/types/classroom'
import type { StudentProfile } from '@/shared/types/student'
import OverviewTab, { CLASS_ROLE_PRESETS } from './OverviewTab'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { setClassRole: vi.fn() } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn() } }))
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

function renderTab({ perms, student }: { perms: ClassPerm[]; student: StudentProfile }) {
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: perms } as never)
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
