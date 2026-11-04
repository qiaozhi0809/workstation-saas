import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parentApi } from '@/shared/api/parent'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import type { ParentExamDetail, ParentExamItem } from '@/shared/types/parent'
import ParentLayout from '../ParentLayout'
import { child, mockWidth, setParentUser } from '../testkit'
import GradesPage from './GradesPage'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), exams: vi.fn(), exam: vi.fn() },
}))

const item = (id: string, over: Partial<ParentExamItem> = {}): ParentExamItem => ({
  id, name: `期中考试${id}`, exam_type: '期中', date: '2026-10-20', year_name: '2026-2027学年', class_name: '三年二班', ...over,
})
const detail = (over: Partial<ParentExamDetail> = {}): ParentExamDetail => ({
  exam: item('x1'),
  subjects: [
    { name: '语文', full: 100, score: 92, class_avg: 85.5, class_max: 99 },
    { name: '数学', full: 100, score: 88, class_avg: 80, class_max: 100 },
  ],
  total: 180, total_full: 200, ranked: 30, class_rank: null, band: null, ...over,
})

function open(entry = '/parent/grades?child=s1') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/parent" element={<ProtectedRoute context="parent"><ParentLayout /></ProtectedRoute>}>
            <Route path="grades" element={<GradesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue([child()])
  vi.mocked(parentApi.exams).mockResolvedValue([item('x1')])
  vi.mocked(parentApi.exam).mockResolvedValue(detail())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const openExam = async () => fireEvent.click(await screen.findByRole('button', { name: /期中考试x1/ }))

it('lists exams with name, date and year · class', async () => {
  open()
  const b = await screen.findByRole('button', { name: /期中考试x1/ })
  expect(b).toHaveTextContent('2026-10-20 · 2026-2027学年 · 三年二班')
})

it('says so when there are no exams', async () => {
  vi.mocked(parentApi.exams).mockResolvedValue([])
  open()
  expect(await screen.findByText('还没有考试成绩')).toBeInTheDocument()
})

it('shows a retryable error when the list fails', async () => {
  vi.mocked(parentApi.exams).mockRejectedValue(new Error('x'))
  open()
  expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('shows the subject table, total, and a scrollable wrapper', async () => {
  open()
  await openExam()
  const wrap = await screen.findByRole('region', { name: '各科成绩' })
  expect(wrap).toHaveClass('overflow-x-auto')
  const row = within(wrap).getByRole('row', { name: /语文/ })
  expect(row).toHaveTextContent('92 / 100')
  expect(row).toHaveTextContent('85.5')
  expect(row).toHaveTextContent('99')
  expect(screen.getByText('总分 180 / 200')).toBeInTheDocument()
  expect(screen.queryByTestId('rank-line')).toBeNull()
})

it('shows the class rank when given', async () => {
  vi.mocked(parentApi.exam).mockResolvedValue(detail({ class_rank: 3, ranked: 30 }))
  open()
  await openExam()
  expect(await screen.findByText('班级第 3 名 / 共 30 人')).toBeInTheDocument()
})

it.each(['前 10%', '前 30%'] as const)('shows the band %s', async (band) => {
  vi.mocked(parentApi.exam).mockResolvedValue(detail({ band }))
  open()
  await openExam()
  expect(await screen.findByText(`班级${band}`)).toBeInTheDocument()
})

it('shows no rank line when both rank and band are empty', async () => {
  open()
  await openExam()
  await screen.findByText('总分 180 / 200')
  expect(screen.queryByTestId('rank-line')).toBeNull()
})

it('shows 缺考 for a null score and dashes for missing class stats and total', async () => {
  vi.mocked(parentApi.exam).mockResolvedValue(detail({
    subjects: [{ name: '英语', full: 100, score: null, class_avg: null, class_max: null }],
    total: null,
  }))
  open()
  await openExam()
  const row = await screen.findByRole('row', { name: /英语/ })
  expect(within(row).getByText('缺考')).toBeInTheDocument()
  expect(within(row).getAllByText('—')).toHaveLength(2)
  expect(screen.getByText('总分 —')).toBeInTheDocument()
})

it('shows an error when the detail fails', async () => {
  vi.mocked(parentApi.exam).mockRejectedValue(new Error('x'))
  open()
  await openExam()
  expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('resets the opened exam when switching child and still works for a read-only child', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([
    child(),
    child({ student_id: 's2', name: '王小二', status: 'readonly', left_on: '2026-07-10', archive_on: '2027-07-10' }),
  ])
  vi.mocked(parentApi.exams).mockImplementation(async (sid) => [item(sid === 's1' ? 'x1' : 'y1')])
  open()
  await openExam()
  await screen.findByRole('region', { name: '各科成绩' })
  fireEvent.change(screen.getByRole('combobox', { name: '切换孩子' }), { target: { value: 's2' } })
  expect(await screen.findByRole('button', { name: /期中考试y1/ })).toHaveAttribute('aria-expanded', 'false')
  await waitFor(() => expect(screen.queryByRole('region', { name: '各科成绩' })).toBeNull())
  expect(parentApi.exams).toHaveBeenCalledWith('s2')
})

it('treats undefined values like null', async () => {
  vi.mocked(parentApi.exam).mockResolvedValue({
    ...detail(),
    subjects: [{ name: '英语', full: 100, score: undefined, class_avg: undefined, class_max: undefined }],
    total: undefined, class_rank: undefined, band: undefined,
  } as unknown as ParentExamDetail)
  open()
  await openExam()
  const row = await screen.findByRole('row', { name: /英语/ })
  expect(within(row).getByText('缺考')).toBeInTheDocument()
  expect(within(row).getAllByText('—')).toHaveLength(2)
  expect(screen.getByText('总分 —')).toBeInTheDocument()
  expect(screen.queryByTestId('rank-line')).toBeNull()
})
