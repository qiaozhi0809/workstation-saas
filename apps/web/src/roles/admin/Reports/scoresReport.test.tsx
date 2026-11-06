import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { downloadBlob } from '@/shared/lib/download'
import type { GradeExam, ScoreStudentRow, ScoreSummary, SubjectStat } from '@/shared/types/admin'
import { ADMIN_PAGES } from '../pages'
import ScoresReportPage from './ScoresReportPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    gradeExams: vi.fn(),
    scoreReport: vi.fn(),
    scoreStudents: vi.fn(),
    exportScoreReport: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/lib/download', () => ({ downloadBlob: vi.fn() }))

const ge = (id: string, name: string, date: string): GradeExam => ({
  id,
  grade_id: 'g3',
  grade_name: '三年级',
  name,
  exam_type: '月考',
  date,
  subjects: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  classes: [],
  missing_classes: [],
})
const EXAMS = [ge('ge2', '十一月联考', '2026-11-03'), ge('ge1', '十月联考', '2026-10-20')]

const stat = (subject: string, o: Partial<SubjectStat> = {}): SubjectStat => ({
  subject,
  full: 100,
  count: 38,
  missing: 2,
  avg: 82.345,
  max: 99,
  min: 41,
  pass_rate: 0.8571,
  good_rate: 0.25,
  ...o,
})
const total = (avg: number | null) => ({ full: 200, count: 38, avg, max: 190, min: 90 })
const SUMMARY: ScoreSummary = {
  grade_exam: { id: 'ge2', name: '十一月联考', date: '2026-11-03', grade_name: '三年级' },
  subjects: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  classes: [
    {
      class_id: 'c1',
      class_name: '三年一班',
      subjects: [
        stat('语文'),
        stat('数学', { avg: null, pass_rate: null, good_rate: null, count: 0 }),
      ],
      total: total(160.04),
    },
    {
      class_id: 'c2',
      class_name: '三年二班',
      subjects: [
        stat('语文', { avg: 70, pass_rate: 0.5, good_rate: 0.1 }),
        stat('数学', { avg: 75.5, pass_rate: 1, good_rate: 0.333 }),
      ],
      total: total(145.5),
    },
  ],
  grade: {
    subjects: [
      stat('语文', { avg: 76.2, pass_rate: 0.7, good_rate: 0.2 }),
      stat('数学', { avg: 75.5, pass_rate: 1, good_rate: 0.333 }),
    ],
    total: total(150.2),
  },
}

const stu = (
  id: string,
  name: string,
  cls: [string, string],
  scores: [number | null, number | null],
  tot: number | null,
  cr: number | null,
  gr: number | null,
): ScoreStudentRow => ({
  student_id: id,
  name,
  student_no: id.toUpperCase(),
  class_id: cls[0],
  class_name: cls[1],
  scores: { 语文: scores[0], 数学: scores[1] },
  total: tot,
  class_rank: cr,
  grade_rank: gr,
})
const STUDENTS: ScoreStudentRow[] = [
  stu('s1', '王小一', ['c1', '三年一班'], [90, 95], 185, 1, 1),
  stu('s2', '李小二', ['c1', '三年一班'], [80, 99], 179, 2, 2),
  stu('s3', '张小三', ['c1', '三年一班'], [70, null], 70, 3, 5),
  stu('s4', '赵小四', ['c1', '三年一班'], [null, null], null, null, null),
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.gradeExams).mockResolvedValue(EXAMS)
  vi.mocked(adminApi.scoreReport).mockResolvedValue(SUMMARY)
  vi.mocked(adminApi.scoreStudents).mockResolvedValue({ students: STUDENTS })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = async (url = '/admin/reports/scores') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ScoresReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByRole('table', { name: '班级成绩汇总' })
}
const classRow = (name: string) =>
  within(screen.getByRole('table', { name: '班级成绩汇总' })).getByRole('row', {
    name: new RegExp(name),
  })
// 格子里显示的值:带提示的格子取按钮上的文字(提示文字也在格子里),破折号格子取全文
const cellTexts = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => within(c).queryByRole('button')?.textContent ?? c.textContent)

it('defaults to the most recent grade exam and can switch', async () => {
  await renderPage()
  expect(adminApi.scoreReport).toHaveBeenCalledWith('ge2')
  expect(screen.getByLabelText('选择联考')).toHaveValue('ge2')
  vi.mocked(adminApi.scoreReport).mockResolvedValue({
    ...SUMMARY,
    grade_exam: { ...SUMMARY.grade_exam, id: 'ge1', name: '十月联考' },
  })
  fireEvent.change(screen.getByLabelText('选择联考'), { target: { value: 'ge1' } })
  await waitFor(() => expect(adminApi.scoreReport).toHaveBeenCalledWith('ge1'))
})

it('shows averages with one decimal, dashes for null, and a grade total row', async () => {
  await renderPage()
  expect(cellTexts(classRow('三年一班'))).toEqual(['82.3', '—', '160.0'])
  expect(within(classRow('三年二班')).getByText('75.5')).toBeInTheDocument()
  const grade = within(classRow('全年级'))
  expect(grade.getByText('76.2')).toBeInTheDocument()
  expect(grade.getByText('150.2')).toBeInTheDocument()
})

it('switches to pass rate and good rate shown as percentages with one decimal', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('tab', { name: '及格率' }))
  expect(cellTexts(classRow('三年一班'))).toEqual(['85.7%', '—', '—'])
  expect(cellTexts(classRow('三年二班'))).toEqual(['50.0%', '100.0%', '—'])
  fireEvent.click(screen.getByRole('tab', { name: '优秀率' }))
  expect(cellTexts(classRow('三年一班'))).toEqual(['25.0%', '—', '—'])
  expect(cellTexts(classRow('三年二班'))).toEqual(['10.0%', '33.3%', '—'])
})

it('maps cells by subject name when a class lists its subjects in a different order', async () => {
  const swapped = structuredClone(SUMMARY)
  swapped.classes[0].subjects.reverse()
  vi.mocked(adminApi.scoreReport).mockResolvedValue(swapped)
  await renderPage()
  // 一班:语文 82.3,数学无数据,与表头顺序(语文、数学)对应,而不是跟着数组顺序走
  expect(cellTexts(classRow('三年一班'))).toEqual(['82.3', '—', '160.0'])
})

it('exposes max, min and participant count as a focusable tip, not a title attribute (L41)', async () => {
  await renderPage()
  const cells = within(classRow('三年一班')).getAllByRole('cell')
  // 数值本身可聚焦(键盘能到),提示文字作为它的描述;没有 title
  const stat = within(cells[0]).getByRole('button', { name: '82.3' })
  expect(stat).toHaveAccessibleDescription('最高 99 · 最低 41 · 参考 38 人')
  expect(within(cells[0]).getByRole('tooltip')).toHaveTextContent('最高 99 · 最低 41 · 参考 38 人')
  expect(cells[0]).not.toHaveAttribute('title')
  expect(stat).not.toHaveAttribute('title')
  // 触屏:点一下固定显示,再点收起;移开焦点也收起
  expect(within(cells[0]).getByRole('tooltip')).not.toHaveAttribute('data-open')
  fireEvent.click(stat)
  expect(within(cells[0]).getByRole('tooltip')).toHaveAttribute('data-open', 'true')
  fireEvent.click(stat)
  expect(within(cells[0]).getByRole('tooltip')).not.toHaveAttribute('data-open')
  fireEvent.click(stat)
  fireEvent.blur(stat, { relatedTarget: document.body })
  expect(within(cells[0]).getByRole('tooltip')).not.toHaveAttribute('data-open')
  // 没有数据的格子只有破折号,没有提示;总分格也有提示
  expect(within(cells[1]).queryByRole('button')).toBeNull()
  expect(within(cells[1]).queryByRole('tooltip')).toBeNull()
  expect(within(cells[2]).getByRole('button', { name: '160.0' })).toHaveAccessibleDescription(
    '最高 190 · 最低 90 · 参考 38 人',
  )
  expect(
    within(classRow('全年级')).getByRole('button', { name: '150.2' }),
  ).toHaveAccessibleDescription('最高 190 · 最低 90 · 参考 38 人')
})

it('says there is no permission when the exam list is forbidden, without a retry button (L41)', async () => {
  vi.mocked(adminApi.gradeExams).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScoresReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('没有权限查看成绩汇总')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  expect(screen.queryByText('加载失败')).toBeNull()
})

it('says there is no permission when the summary of the chosen exam is forbidden (L41)', async () => {
  vi.mocked(adminApi.scoreReport).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScoresReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('没有权限查看成绩汇总')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  // 其他错误仍是可重试的通用错误
  vi.mocked(adminApi.scoreReport).mockRejectedValue(new ApiError(500, 'X', 'boom'))
  fireEvent.change(screen.getByLabelText('选择联考'), { target: { value: 'ge1' } })
  expect(await screen.findByText('成绩汇总加载失败')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('expands a class into its student table with ranks and sorts by column', async () => {
  await renderPage()
  const toggle = within(classRow('三年一班')).getByRole('button', { name: '三年一班' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(adminApi.scoreStudents).toHaveBeenCalledWith('ge2', 'c1'))
  const table = await screen.findByRole('table', { name: '三年一班 学生成绩' })
  const names = () =>
    within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[1].textContent)
  expect(names()).toEqual(['王小一', '李小二', '张小三', '赵小四'])
  const first = within(within(table).getAllByRole('row')[1])
    .getAllByRole('cell')
    .map((c) => c.textContent)
  expect(first).toEqual(['S1', '王小一', '90', '95', '185', '1', '1'])
  const last = within(within(table).getAllByRole('row')[4])
    .getAllByRole('cell')
    .map((c) => c.textContent)
  expect(last).toEqual(['S4', '赵小四', '—', '—', '—', '—', '—'])

  // 点数学列:降序,空值始终排最后
  fireEvent.click(within(table).getByRole('button', { name: '数学' }))
  expect(names()).toEqual(['李小二', '王小一', '张小三', '赵小四'])
  expect(within(table).getByRole('columnheader', { name: /数学/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
  // 再点一次:升序,空值仍在最后
  fireEvent.click(within(table).getByRole('button', { name: '数学' }))
  expect(names()).toEqual(['王小一', '李小二', '张小三', '赵小四'])
  expect(within(table).getByRole('columnheader', { name: /数学/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )

  // 再点班名收起
  fireEvent.click(toggle)
  expect(screen.queryByRole('table', { name: '三年一班 学生成绩' })).toBeNull()
})

it('exports the csv through the shared downloadBlob with the grade exam name as file name (L43)', async () => {
  const blob = new Blob(['x'], { type: 'text/csv' })
  vi.mocked(adminApi.exportScoreReport).mockResolvedValue(blob)
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
  await waitFor(() => expect(adminApi.exportScoreReport).toHaveBeenCalledWith('ge2'))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(downloadBlob).toHaveBeenCalledWith(blob, '十一月联考-成绩汇总.csv')
  // 页面自己不再造 <a download>
  expect(document.querySelector('a[download]')).toBeNull()
})

it('tells the user when the export fails', async () => {
  vi.mocked(adminApi.exportScoreReport).mockRejectedValue(new Error('x'))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('导出失败,请重试'))
})

it('shows an empty state when there is no grade exam', async () => {
  vi.mocked(adminApi.gradeExams).mockResolvedValue([])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScoresReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('还没有年级联考')).toBeInTheDocument()
  expect(adminApi.scoreReport).not.toHaveBeenCalled()
})

it('shows an empty state instead of the table when the grade exam has no class exams', async () => {
  vi.mocked(adminApi.scoreReport).mockResolvedValue({ ...SUMMARY, classes: [] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScoresReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('暂无班级考试')).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: '班级成绩汇总' })).not.toBeInTheDocument()
  expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled()
  expect(screen.getByLabelText('选择联考')).toHaveValue('ge2')
})

it('opens the exam named in ?exam= instead of the latest one', async () => {
  await renderPage('/admin/reports/scores?exam=ge1')
  expect(screen.getByLabelText('选择联考')).toHaveValue('ge1')
  expect(adminApi.scoreReport).toHaveBeenCalledWith('ge1')
})

it('registers both pages in the admin navigation with their permissions', () => {
  const pick = (path: string) => ADMIN_PAGES.find((p) => p.path === path)
  expect(pick('grade-exams')).toMatchObject({ label: '年级联考', perm: 'exam.grade_write' })
  expect(pick('reports/scores')).toMatchObject({ label: '成绩汇总', perm: 'school.view' })
})
