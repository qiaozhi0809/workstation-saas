import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { GradebookExam } from '@/shared/types/grades'
import { classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import AnalysisPage from './AnalysisPage'
import { TrendGrid } from './TrendGrid'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/students')

const subjects = [{ name: '语文', full: 100 }, { name: '数学', full: 100 }]
function exam(id: string, name: string, date: string, scores: GradebookExam['scores']): GradebookExam {
  return {
    id, name, exam_type: '月考', date, subjects, created_by_me: true,
    progress: { entered: 3, total: 3 }, scores,
  }
}
const first = exam('x1', '第一次月考', '2026-09-20', {
  e1: { 语文: 70, 数学: 70 }, e2: { 语文: 60, 数学: 60 }, e3: { 语文: 50, 数学: 50 },
})
const second = exam('x2', '期中考试', '2026-10-20', {
  e1: { 语文: 90, 数学: 90 }, e2: { 语文: 90, 数学: 90 }, e3: { 语文: 50, 数学: 50 },
})
const unscored = exam('x3', '期末考试', '2026-12-20', {})

function Url() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

function setup(book: GradebookExam[], entry = '/teacher/analysis') {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: book })
  act(() => { useTeacherStore.setState({ classId: 'c1' }) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/teacher/analysis" element={<><AnalysisPage chartWidth={300} /><Url /></>} />
          <Route path="/teacher/scores" element={<div>成绩页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['exam.read'] }))
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
})

// 各科明细表头也有「平均分」,所以只取 KPI 卡片里的那个
const avgCard = async () =>
  (await screen.findAllByText('平均分')).map((el) => el.closest('div[data-kpi]')).find(Boolean) as HTMLElement

describe('AnalysisPage', () => {
  it('defaults to the latest exam compared with the previous one', async () => {
    setup([first, second, unscored])
    const card = await avgCard()
    expect(within(card).getByText(/较第一次月考/)).toBeInTheDocument()
    expect(within(card).getByText(/↑ 16.7 个百分点/)).toBeInTheDocument()
    expect(screen.getByLabelText('考试')).toHaveValue('x2')
    expect(screen.getByLabelText('对比')).toHaveValue('x1')
  })

  it('shows flat and missing deltas', async () => {
    setup([first, second], '/teacher/analysis?exam=x2&cmp=x2')
    expect(within(await avgCard()).getByText('与上次持平')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('对比'), { target: { value: 'none' } })
    expect(screen.getByTestId('url')).toHaveTextContent('cmp=none')
    expect(within(await avgCard()).getByText('—')).toBeInTheDocument()
  })

  it('names every top scorer', async () => {
    setup([first, second])
    const max = (await screen.findByText('最高分')).closest('div[data-kpi]') as HTMLElement
    expect(within(max).getByText('王小一、李小二')).toBeInTheDocument()
  })

  it('resets the comparison when the exam changes', async () => {
    setup([first, second], '/teacher/analysis?exam=x2&cmp=none&student=s1')
    await avgCard()
    fireEvent.change(screen.getByLabelText('考试'), { target: { value: 'x1' } })
    const url = screen.getByTestId('url').textContent ?? ''
    expect(url).toContain('exam=x1')
    expect(url).toContain('student=s1')
    expect(url).not.toContain('cmp=')
  })

  it('hides trends with fewer than two scored exams', async () => {
    setup([first, unscored])
    await avgCard()
    expect(screen.queryByText(/纵轴/)).not.toBeInTheDocument()
  })

  it('shows the empty state without scores', async () => {
    setup([unscored])
    expect(await screen.findByText('还没有考试成绩')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去录入成绩' })).toHaveAttribute('href', '/teacher/scores')
  })
})

describe('TrendGrid', () => {
  it('renders a total chart and one per subject with a shared axis note', () => {
    render(<TrendGrid book={[first, second]} ids={['e1', 'e2', 'e3']} width={300} />)
    expect(screen.getByText('纵轴 55–85%')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })
})
