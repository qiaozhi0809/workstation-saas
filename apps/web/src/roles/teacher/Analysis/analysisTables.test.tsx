import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { schoolApi } from '@/shared/api/school'
import { studentsApi } from '@/shared/api/students'
import { DEFAULT_GRADING } from '@/shared/lib/grades'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { GradebookExam } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import AnalysisPage from './AnalysisPage'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/school')
vi.mock('@/shared/api/students')

const twoSubjects = [
  { name: '语文', full: 100 },
  { name: '数学', full: 100 },
]
function exam(
  id: string,
  name: string,
  date: string,
  scores: GradebookExam['scores'],
  subjects = twoSubjects,
): GradebookExam {
  return {
    id,
    name,
    exam_type: '月考',
    date,
    subjects,
    grade_exam_id: null,
    created_by_me: true,
    progress: { entered: 3, total: 3 },
    scores,
  }
}

const first = exam('x1', '第一次月考', '2026-09-20', {
  e1: { 语文: 70, 数学: 70 },
  e2: { 语文: 60, 数学: 60 },
  e3: { 语文: 50, 数学: 50 },
})
const second = exam('x2', '期中考试', '2026-10-20', {
  e1: { 语文: 90, 数学: 90 },
  e2: { 语文: 90, 数学: 90 },
  e3: { 语文: 50, 数学: null },
})

const names7 = ['王小一', '李小二', '张小三', '赵小四', '钱小五', '孙小六', '周小七']
const roster7: StudentSeat[] = names7.map((name, i) => ({
  ...rosterFixture[0],
  enrollment_id: `e${i + 1}`,
  student_id: `s${i + 1}`,
  name,
  mk: `S100${i + 1}`,
}))
const pair = (v: number) => ({ 语文: v, 数学: v })
const prev7 = exam('p1', '上次月考', '2026-09-20', {
  e1: pair(90),
  e2: pair(80),
  e3: pair(70),
  e4: pair(60),
  e5: pair(50),
  e6: pair(40),
  e7: pair(30),
})
const cur7 = exam('p2', '本次月考', '2026-10-20', {
  e1: pair(30),
  e2: pair(80),
  e3: pair(70),
  e4: pair(60),
  e5: pair(50),
  e6: pair(40),
  e7: pair(95),
})

function Url() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

const urlParams = () =>
  new URLSearchParams((screen.getByTestId('url').textContent ?? '').split('?')[1] ?? '')

function setup(
  book: GradebookExam[],
  entry = '/teacher/analysis',
  roster: StudentSeat[] = rosterFixture,
) {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: book })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster })
  act(() => {
    useTeacherStore.setState({ classId: 'c1' })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/teacher/analysis',
        element: (
          <>
            <AnalysisPage chartWidth={300} />
            <Url />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  )
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['exam.read'] }))
  vi.mocked(schoolApi.grading).mockResolvedValue(DEFAULT_GRADING)
})

const rankRegion = async () => within(await screen.findByRole('region', { name: '成绩排名' }))
const groupOf = async (title: string) =>
  within((await screen.findByText(title)).closest('section') as HTMLElement)

describe('RankTable', () => {
  it('lists ranks with changes and opens the scores tab on click', async () => {
    setup([first, second], '/teacher/analysis?exam=x2&cmp=x1')
    const table = await rankRegion()
    const rows = table.getAllByRole('row')
    // 表头 + 3 行;名次、总分
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getByText('1')).toBeInTheDocument()
    expect(within(rows[1]).getByText('180')).toBeInTheDocument()
    expect(table.getByText('↑1')).toHaveClass('text-success')
    expect(table.getAllByText('0').length).toBeGreaterThan(0)
    // 张小三:语文 50 不及格(红字),数学缺考
    const third = rows[3]
    expect(within(third).getByText('缺考')).toBeInTheDocument()
    expect(within(third).getAllByText('50')[0]).toHaveClass('text-destructive')
    fireEvent.click(table.getByRole('button', { name: '王小一' }))
    const q = urlParams()
    expect(q.get('student')).toBe('s1')
    expect(q.get('tab')).toBe('成绩')
    expect(q.get('exam')).toBe('x2')
  })

  it('hides the change column without a comparison', async () => {
    setup([first, second], '/teacher/analysis?exam=x2&cmp=none')
    const table = await rankRegion()
    expect(table.queryByRole('columnheader', { name: '进退' })).not.toBeInTheDocument()
    expect(table.getByRole('columnheader', { name: '总分' })).toBeInTheDocument()
  })

  it('shows falls in destructive and keeps the table scrollable', async () => {
    setup([prev7, cur7], '/teacher/analysis?exam=p2&cmp=p1', roster7)
    const table = await rankRegion()
    expect(table.getByText('↓6')).toHaveClass('text-destructive')
    expect(table.getByTestId('rank-scroll')).toHaveClass('max-h-[460px]', 'overflow-auto')
  })
})

describe('AttentionPanel', () => {
  it('groups risers, fallers and students failing two subjects', async () => {
    setup([prev7, cur7], '/teacher/analysis?exam=p2&cmp=p1', roster7)
    const riser = await groupOf('进步之星')
    expect(riser.getByRole('button', { name: /周小七/ })).toBeInTheDocument()
    expect(riser.getByText(/↑6/)).toBeInTheDocument()
    const faller = await groupOf('退步 5 名以上')
    expect(faller.getByRole('button', { name: /王小一/ })).toBeInTheDocument()
    expect(faller.getByText(/↓6/)).toBeInTheDocument()
    const failing = await groupOf('两科及以上不及格')
    for (const n of ['王小一', '钱小五', '孙小六']) {
      expect(failing.getByRole('button', { name: new RegExp(n) })).toBeInTheDocument()
    }
    expect(failing.getByRole('button', { name: '王小一 2 科' })).toBeInTheDocument()
    fireEvent.click(failing.getByRole('button', { name: /钱小五/ }))
    expect(urlParams().get('student')).toBe('s5')
    expect(urlParams().get('tab')).toBe('成绩')
  })

  it('shows 暂无 for empty groups without a comparison', async () => {
    setup([prev7, cur7], '/teacher/analysis?exam=p2&cmp=none', roster7)
    const riser = await groupOf('进步之星')
    expect(riser.getByText('暂无')).toBeInTheDocument()
    expect((await groupOf('退步 5 名以上')).getByText('暂无')).toBeInTheDocument()
  })

  it('drops the two-subject group for a single visible subject', async () => {
    const one = exam(
      'o1',
      '单科测验',
      '2026-10-20',
      { e1: { 语文: 30 }, e2: { 语文: 90 }, e3: { 语文: 20 } },
      [{ name: '语文', full: 100 }],
    )
    setup([one])
    await screen.findByText('进步之星')
    expect(screen.queryByText('两科及以上不及格')).not.toBeInTheDocument()
  })
})

describe('SubjectTable', () => {
  it('shows the subject table with pass-rate changes only when comparing', async () => {
    setup([first, second], '/teacher/analysis?exam=x2&cmp=x1')
    const region = within(await screen.findByRole('region', { name: '各科明细' }))
    for (const h of [
      '科目',
      '满分',
      '平均分',
      '得分率',
      '最高',
      '最低',
      '及格率',
      '优秀率',
      '不及格人数',
      '得分率变化',
    ]) {
      expect(region.getByRole('columnheader', { name: h })).toBeInTheDocument()
    }
    const chinese = region.getByRole('row', { name: /语文/ })
    expect(within(chinese).getByText('+16.7 个百分点')).toBeInTheDocument()
    expect(within(chinese).getByText('76.7%')).toBeInTheDocument()
    expect(region.getByText('及格 = 满分 60%,优秀 = 满分 85%')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('对比'), { target: { value: 'none' } })
    expect(region.queryByRole('columnheader', { name: '得分率变化' })).not.toBeInTheDocument()
  })

  it('footnote follows the school ratios', async () => {
    vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
    setup([first, second], '/teacher/analysis?exam=x2')
    const region = within(await screen.findByRole('region', { name: '各科明细' }))
    expect(await region.findByText('及格 = 满分 70%,优秀 = 满分 90%')).toBeInTheDocument()
    // 90 90 50:>= 70 的 2 人、>= 90 的 2 人,与脚注同一口径
    const chinese = region.getByRole('row', { name: /语文/ })
    expect(within(chinese).getAllByText('66.7%')).toHaveLength(2)
  })

  it('shows a dash for a subject missing from the comparison exam', async () => {
    const other = exam(
      'o1',
      '旧测验',
      '2026-09-01',
      { e1: { 英语: 80 }, e2: { 英语: 80 }, e3: { 英语: 80 } },
      [{ name: '英语', full: 100 }],
    )
    setup([other, second], '/teacher/analysis?exam=x2&cmp=o1')
    const region = within(await screen.findByRole('region', { name: '各科明细' }))
    expect(within(region.getByRole('row', { name: /语文/ })).getByText('—')).toBeInTheDocument()
  })
})
