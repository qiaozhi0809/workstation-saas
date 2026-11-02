import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import type { Gradebook } from '@/shared/types/grades'
import type { StudentProfile } from '@/shared/types/student'
import { MemoryRouter } from 'react-router-dom'
import { studentsApi } from '@/shared/api/students'
import ScoresTab from './ScoresTab'
import StudentProfileDrawer from './StudentProfileDrawer'

vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn().mockResolvedValue({ my_perms: [] }) } }))
vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn().mockResolvedValue({ items: [] }) } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn() } }))
const trendLine = vi.hoisted(() => vi.fn())
vi.mock('@/shared/components/charts/TrendLine', () => ({
  TrendLine: (props: { label: string; yAxisWidth?: number }) => { trendLine(props); return <div role="img" aria-label={props.label} /> },
}))

const profile: StudentProfile = { id: 's1', mk: 'S0001', name: '王小一', class_id: 'c1', enrollment_id: 'e1' }
const subjects = [{ name: '语文', full: 100 }, { name: '数学', full: 100 }]
const base = { exam_type: '月考' as const, subjects, created_by_me: true, progress: { entered: 3, total: 3 } }
const book: Gradebook = {
  exams: [
    { ...base, id: 'x1', name: '九月月考', date: '2026-09-20',
      scores: { e1: { 语文: 80, 数学: 70 }, e2: { 语文: 90, 数学: 90 }, e3: { 语文: 50, 数学: 60 } } },
    { ...base, id: 'x2', name: '十月月考', date: '2026-10-25',
      scores: { e1: { 语文: 55, 数学: null }, e2: { 语文: 70, 数学: 80 }, e3: { 语文: 90, 数学: 70 } } },
  ],
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ScoresTab profile={profile} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(examsApi.gradebook).mockResolvedValue(book)
})

it('lists exams with failing scores in red and absent badges', async () => {
  renderTab()
  expect(await screen.findByText('十月月考')).toBeInTheDocument()
  expect(examsApi.gradebook).toHaveBeenCalledWith('c1')
  const rows = screen.getAllByRole('row')
  const latest = within(rows[1])
  expect(latest.getByText('十月月考')).toBeInTheDocument()
  expect(latest.getByText('2026-10-25')).toBeInTheDocument()
  expect(latest.getAllByText('55')[0]).toHaveClass('text-destructive')
  expect(latest.getByText('缺考')).toBeInTheDocument()
  expect(latest.getByText('3')).toBeInTheDocument()
  const older = within(rows[2])
  expect(older.getByText('80')).not.toHaveClass('text-destructive')
  expect(older.queryByText('缺考')).toBeNull()
  expect(screen.getByText('红色为不及格(低于满分的 60%)')).toBeInTheDocument()
})

it('draws the rank curve reversed', async () => {
  renderTab()
  await screen.findByRole('img', { name: '排名变化' })
  const props = trendLine.mock.calls.at(-1)![0]
  expect(props.reversed).toBe(true)
  expect(props.labels).toEqual(['九月月考', '十月月考'])
  expect(props.series[0].values).toEqual([2, 3])
  expect(props.format(3)).toBe('第 3 名')
  expect(props.yAxisWidth).toBe(64) // 放得下“第 NN 名”(两位数名次不折行)
})

it('says there is no score permission on 403', async () => {
  vi.mocked(examsApi.gradebook).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'))
  renderTab()
  expect(await screen.findByText('没有成绩权限')).toBeInTheDocument()
})

it('says there are no scores when the student has none', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [{ ...book.exams[0], scores: { e2: { 语文: 90, 数学: 90 } } }] })
  renderTab()
  expect(await screen.findByText('还没有考试成绩')).toBeInTheDocument()
})

it('shows an error state with retry on other failures', async () => {
  vi.mocked(examsApi.gradebook).mockRejectedValueOnce(new ApiError(500, 'X', 'boom')).mockResolvedValue(book)
  renderTab()
  const retry = await screen.findByRole('button', { name: '重试' })
  retry.click()
  expect(await screen.findByText('十月月考')).toBeInTheDocument()
})

it('is mounted in the real drawer on the 成绩 tab instead of the 暂未开放 placeholder', async () => {
  vi.mocked(studentsApi.detail).mockResolvedValue(profile)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/x?student=s1&tab=成绩']}><StudentProfileDrawer studentId="s1" /></MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('红色为不及格(低于满分的 60%)')).toBeInTheDocument()
  expect(screen.getByText('十月月考')).toBeInTheDocument()
  expect(screen.queryByText('暂未开放')).toBeNull()
})
