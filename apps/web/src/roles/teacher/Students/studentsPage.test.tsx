import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { downloadText } from '@/shared/lib/csv'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm, ClassroomSummary } from '@/shared/types/classroom'
import type { GradebookExam } from '@/shared/types/grades'
import { rec } from './fixtures'
import StudentsPage from './StudentsPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({
  studentsApi: { records: vi.fn(), exportRecords: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), importRows: vi.fn() },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/api/reviews', () => ({ reviewsApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams', () => ({ examsApi: { gradebook: vi.fn() } }))
vi.mock('@/shared/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/shared/lib/csv')>()), downloadText: vi.fn() }))

const cls: ClassView = { id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 6, seat_cols: 4, desk_size: 2, seat_layout: 'manual', seat_order: 'row', podium_left: 0, podium_right: 0, room: '', role: 'homeroom_teacher' }
const ALL: ClassPerm[] = ['review.read', 'exam.read', 'student.export']
const MANAGE: ClassPerm[] = ['student.manage']

const summary = (perms: ClassPerm[]) => ({ today: '2026-11-02', my_perms: perms, my_subjects: [] }) as unknown as ClassroomSummary

const contacts = [{ name: '张父', relation: '父亲', phone: '13800000001', job: '' }]
const records = [
  rec({ enrollment_id: 'e1', name: '张三', student_no: '1', contacts, tags: ['a', 'b', 'c', 'd', 'e'], birthdate: '2015-11-02' }),
  rec({ enrollment_id: 'e2', name: '李四', student_no: '2', gender: '女', birthdate: '2015-05-05' }),
]
const exam = (id: string, scores: GradebookExam['scores']) => ({
  id, name: id, exam_type: '月考', date: '2026-10-01', subjects: [{ name: '数学', full: 100 }],
  created_by_me: true, progress: { entered: 2, total: 2 }, scores,
}) as GradebookExam

function Url() {
  return <div data-testid="url">{useLocation().search}</div>
}

const renderPage = (entry = '/teacher/students') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}><Url /><StudentsPage /></MemoryRouter>
  </QueryClientProvider>,
)

function setup(perms: ClassPerm[], recs = records) {
  vi.mocked(classroomApi.summary).mockResolvedValue(summary(perms))
  vi.mocked(studentsApi.records).mockResolvedValue({ items: recs })
}

beforeEach(() => {
  vi.resetAllMocks()
  useTeacherStore.setState({ classId: 'c1' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(reviewsApi.summary).mockResolvedValue({
    week_start: '2026-11-02',
    items: [{ enrollment_id: 'e1', total: 3, week: 1, plus_count: 3, minus_count: 0 }, { enrollment_id: 'e2', total: 8, week: 1, plus_count: 8, minus_count: 0 }],
  })
  vi.mocked(examsApi.gradebook).mockResolvedValue({
    exams: [exam('x1', { e1: { 数学: 80 }, e2: { 数学: 90 } }), exam('x2', { e1: { 数学: 95 }, e2: { 数学: 90 } })],
  })
})

it('opens the profile drawer from a row', async () => {
  setup(ALL)
  renderPage()
  fireEvent.click(await screen.findByText('张三'))
  expect(screen.getByTestId('url').textContent).toBe('?student=s-e1')
})

it('hides contacts, points and rank columns without the permissions', async () => {
  const bare = records.map((r) => { const copy = { ...r }; delete copy.contacts; return copy })
  setup([], bare)
  renderPage()
  await screen.findByText('张三')
  for (const h of ['主要联系人', '排名', '积分']) expect(screen.queryByRole('columnheader', { name: new RegExp(h) })).toBeNull()
  expect(screen.queryByRole('button', { name: '导出名单' })).toBeNull()
  expect(reviewsApi.summary).not.toHaveBeenCalled()
  expect(examsApi.gradebook).not.toHaveBeenCalled()
})

it('shows contacts, tag overflow, rank with change arrows and points', async () => {
  setup(ALL)
  renderPage()
  await screen.findByText('张三')
  const row1 = screen.getByText('张三').closest('tr')!
  expect(within(row1).getByText('张父 13800000001')).toBeInTheDocument()
  expect(within(row1).getByText('+2')).toBeInTheDocument()
  expect(within(row1).queryByText('d')).toBeNull()
  await waitFor(() => expect(within(row1).getByTestId('rank')).toHaveTextContent('1'))
  expect(within(row1).getByText('↑1')).toBeInTheDocument()
  const cells = within(row1).getAllByRole('cell')
  expect(cells[cells.length - 1]).toHaveTextContent('3')
  expect(row1.querySelector('[data-birthday-today]')).not.toBeNull()
})

it('keeps cells and headers on one line and the filter tabs unsqueezed on narrow screens', async () => {
  setup(ALL)
  renderPage()
  await screen.findByText('张三')
  for (const h of screen.getAllByRole('columnheader')) expect(h).toHaveClass('whitespace-nowrap')
  const row1 = screen.getByText('张三').closest('tr')!
  // 标签列允许换行但保底宽度,其余单元格不换行
  const cells = within(row1).getAllByRole('cell')
  const tagCell = within(row1).getByText('+2').closest('td')!
  expect(tagCell).toHaveClass('min-w-[8rem]')
  for (const c of cells) if (c !== tagCell) expect(c).toHaveClass('whitespace-nowrap')
  expect(screen.getByRole('tablist', { name: '筛选' }).parentElement).toHaveClass('w-max', 'whitespace-nowrap')
})

it('filters by search and chips', async () => {
  setup(ALL)
  renderPage()
  await screen.findByText('张三')
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索学生' }), { target: { value: '李' } })
  expect(screen.queryByText('张三')).toBeNull()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索学生' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('tab', { name: '女' }))
  expect(screen.queryByText('张三')).toBeNull()
  expect(screen.getByText('李四')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '班干部' }))
  expect(screen.getByText('没有符合条件的学生')).toBeInTheDocument()
})

it('sorts by header buttons, reversing on the active column', async () => {
  setup(ALL)
  renderPage()
  await screen.findByText('张三')
  const order = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)
  const th = (n: string) => screen.getByRole('columnheader', { name: new RegExp(n) })
  expect(th('学号')).toHaveAttribute('aria-sort', 'ascending')
  fireEvent.click(within(th('学号')).getByRole('button'))
  expect(th('学号')).toHaveAttribute('aria-sort', 'descending')
  expect(order()).toEqual(['李四', '张三'])
  fireEvent.click(within(th('积分')).getByRole('button'))
  expect(th('积分')).toHaveAttribute('aria-sort', 'descending')
  expect(th('学号')).toHaveAttribute('aria-sort', 'none')
  expect(order()).toEqual(['李四', '张三'])
  fireEvent.click(within(th('积分')).getByRole('button'))
  expect(order()).toEqual(['张三', '李四'])
})

it('exports through the audited endpoint', async () => {
  setup(ALL)
  vi.mocked(studentsApi.exportRecords).mockResolvedValue({ items: [records[0]] })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '导出名单' }))
  await waitFor(() => expect(downloadText).toHaveBeenCalled())
  expect(studentsApi.exportRecords).toHaveBeenCalledWith('c1')
  const [name, text] = vi.mocked(downloadText).mock.calls[0]
  expect(name).toBe('三年二班-学生名单.csv')
  expect(text).toContain('张三')
  expect(text).not.toContain('李四')
})

it('shows an error when the export fails', async () => {
  setup(ALL)
  vi.mocked(studentsApi.exportRecords).mockRejectedValue(new Error('x'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '导出名单' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('导出失败')
  expect(downloadText).not.toHaveBeenCalled()
})

it('shows an empty state for a class without students', async () => {
  setup([], [])
  renderPage()
  expect(await screen.findByText('还没有学生')).toBeInTheDocument()
})

it('shows no points and exports blanks while the review summary has not loaded', async () => {
  setup(ALL)
  vi.mocked(reviewsApi.summary).mockReturnValue(new Promise(() => {}))
  vi.mocked(studentsApi.exportRecords).mockResolvedValue({ items: [records[0]] })
  renderPage()
  const row1 = (await screen.findByText('张三')).closest('tr')!
  const cells = within(row1).getAllByRole('cell')
  expect(cells[cells.length - 1]).toHaveTextContent('—')
  fireEvent.click(screen.getByRole('button', { name: '导出名单' }))
  await waitFor(() => expect(downloadText).toHaveBeenCalled())
  const lines = vi.mocked(downloadText).mock.calls[0][1].split('\r\n')
  expect(lines[1].endsWith(',')).toBe(true)
})

it('shows no points when the review summary fails', async () => {
  setup(ALL)
  vi.mocked(reviewsApi.summary).mockRejectedValue(new Error('x'))
  renderPage()
  const row1 = (await screen.findByText('张三')).closest('tr')!
  await waitFor(() => expect(reviewsApi.summary).toHaveBeenCalled())
  const cells = within(row1).getAllByRole('cell')
  expect(cells[cells.length - 1]).toHaveTextContent('—')
})

it('hides add, import and edit without student.manage', async () => {
  setup(ALL)
  renderPage()
  await screen.findByText('张三')
  for (const n of ['添加学生', '批量导入', '编辑']) expect(screen.queryByRole('button', { name: n })).toBeNull()
})

it('opens the edit form from a row without opening the drawer', async () => {
  setup(MANAGE)
  renderPage()
  await screen.findByText('张三')
  fireEvent.click(within(screen.getByText('张三').closest('tr')!).getByRole('button', { name: '编辑' }))
  expect(await screen.findByLabelText('姓名')).toHaveValue('张三')
  await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(''))
})

it('opens the add form and the import dialog from the toolbar', async () => {
  setup(MANAGE)
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '添加学生' }))
  expect(await screen.findByLabelText('姓名')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByLabelText('姓名')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
  expect(await screen.findByLabelText('粘贴名单')).toBeInTheDocument()
})

it('offers adding students from the empty state', async () => {
  setup(MANAGE, [])
  renderPage()
  expect(await screen.findByText('还没有学生')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '添加学生' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '批量导入' })).toBeInTheDocument()
})

it('shows podium seat text in the seat column', async () => {
  setup(ALL, [
    rec({ enrollment_id: 'e1', name: '张三', seat_row: 0, seat_col: 1 }),
    rec({ enrollment_id: 'e2', name: '李四', seat_row: 2, seat_col: 3 }),
  ])
  renderPage()
  const row1 = (await screen.findByText('张三')).closest('tr')!
  expect(within(row1).getByText('讲台右边')).toBeInTheDocument()
  expect(within(screen.getByText('李四').closest('tr')!).getByText('2排3列')).toBeInTheDocument()
})

it('opens the add form from ?action=add and clears the parameter', async () => {
  setup(MANAGE)
  renderPage('/teacher/students?action=add')
  expect(await screen.findByRole('dialog', { name: '添加学生' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(''))
})

it('opens the import dialog from ?action=import and clears the parameter', async () => {
  setup(MANAGE)
  renderPage('/teacher/students?action=import')
  expect(await screen.findByRole('dialog', { name: /导入/ })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(''))
})

it('N5: table scrolls on its own and keeps contacts and tags columns on wide screens', async () => {
  setup(ALL)
  renderPage()
  const table = (await screen.findByRole('table'))
  expect(table.parentElement).toHaveClass('overflow-x-auto')
  // relative:表头 sr-only(绝对定位)必须被这个滚动容器裁剪,否则撑宽整页
  expect(table.parentElement).toHaveClass('relative')
  // 根容器 min-w-0:否则 flex 子项撑开页面,横向滚动落到整页而不是表格自己
  expect(table.closest('.space-y-3')).toHaveClass('min-w-0')
  expect(screen.getByRole('columnheader', { name: '主要联系人' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: '标签' })).toBeInTheDocument()
})

it('N5: hides contacts and tags columns when max-width 639px matches', async () => {
  setup(ALL)
  const original = window.matchMedia
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q === '(max-width: 639px)', addEventListener() {}, removeEventListener() {},
  })) as never
  try {
    renderPage()
    await screen.findByText('张三')
    expect(screen.queryByRole('columnheader', { name: '主要联系人' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: '标签' })).toBeNull()
    expect(screen.queryByText('张父 13800000001')).toBeNull()
    expect(screen.getByRole('columnheader', { name: /姓名/ })).toBeInTheDocument()
  } finally { window.matchMedia = original }
})
