import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import type { BoardView, GradeExam } from '@/shared/types/admin'
import GradeExamsPage from './GradeExamsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    grades: vi.fn(), board: vi.fn(), gradeExams: vi.fn(), createGradeExam: vi.fn(), updateGradeExam: vi.fn(),
    deleteGradeExam: vi.fn(), syncGradeExam: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const boardOf = (...grades: { id: string; name: string }[]): BoardView =>
  ({ grades, grade_id: null, classes: [] })
const G3 = { id: 'g3', name: '三年级' }
const G4 = { id: 'g4', name: '四年级' }

const exam = (over: Partial<GradeExam> = {}): GradeExam => ({
  id: 'ge1', grade_id: 'g3', grade_name: '三年级', name: '十月联考', exam_type: '月考', date: '2026-10-20',
  subjects: [{ name: '语文', full: 100 }, { name: '数学', full: 100 }],
  classes: [
    { class_id: 'c1', class_name: '三年一班', exam_id: 'e1', entered: 20, expected: 40 },
    { class_id: 'c2', class_name: '三年二班', exam_id: 'e2', entered: 40, expected: 40 },
  ],
  missing_classes: [], ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.board).mockResolvedValue(boardOf(G3, G4))
  vi.mocked(adminApi.gradeExams).mockImplementation(async (gid) => (gid === 'g4' ? [] : [exam()]))
})
afterEach(cleanup)

let client: QueryClient
const renderPage = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><GradeExamsPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('十月联考')
}
const row = () => screen.getByRole('listitem', { name: '十月联考' })

it('lists the exams of the selected grade tab with per-class progress', async () => {
  await renderPage()
  expect(adminApi.gradeExams).toHaveBeenCalledWith('g3')
  expect(screen.getByRole('tab', { name: '三年级' })).toHaveAttribute('aria-selected', 'true')
  const r = within(row())
  expect(r.getByText('月考')).toBeInTheDocument()
  expect(r.getByText('2026-10-20')).toBeInTheDocument()
  expect(r.getByText('语文、数学')).toBeInTheDocument()
  expect(r.getByText('三年一班 20/40')).toBeInTheDocument()
  expect(r.getByText('三年二班 40/40')).toBeInTheDocument()
  expect(r.getByRole('progressbar', { name: '三年一班 录分进度' })).toHaveAttribute('aria-valuenow', '50')
  expect(r.getByRole('link', { name: '查看汇总' })).toHaveAttribute('href', '/admin/reports/scores?exam=ge1')

  fireEvent.click(screen.getByRole('tab', { name: '四年级' }))
  await waitFor(() => expect(adminApi.gradeExams).toHaveBeenCalledWith('g4'))
  expect(await screen.findByText('四年级还没有联考')).toBeInTheDocument()
})

it('shows the grade tabs from the board even when /admin/grades is forbidden (grade head)', async () => {
  vi.mocked(adminApi.grades).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'))
  vi.mocked(adminApi.board).mockResolvedValue(boardOf(G3))
  await renderPage()
  expect(screen.getByRole('tab', { name: '三年级' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '四年级' })).toBeNull()
  expect(adminApi.board).toHaveBeenCalledWith(null)
  expect(adminApi.grades).not.toHaveBeenCalled()
})

it('offers to create the missing classes and calls sync', async () => {
  vi.mocked(adminApi.gradeExams).mockResolvedValue([
    exam({ missing_classes: [{ class_id: 'c3', class_name: '三年三班' }] }),
  ])
  vi.mocked(adminApi.syncGradeExam).mockResolvedValue(exam())
  await renderPage()
  expect(within(row()).getByText('有 1 个班还没有这场考试')).toBeInTheDocument()
  fireEvent.click(within(row()).getByRole('button', { name: '补建' }))
  await waitFor(() => expect(adminApi.syncGradeExam).toHaveBeenCalledWith('ge1'))
  expect(toast).toHaveBeenCalledWith('已补建')
})

it('shows no sync prompt when no class is missing', async () => {
  await renderPage()
  expect(screen.queryByRole('button', { name: '补建' })).toBeNull()
})

it('shows the backend message when delete is rejected with 409', async () => {
  vi.mocked(adminApi.deleteGradeExam).mockRejectedValue(
    new ApiError(409, 'EXAM_HAS_SCORES', '三年一班已经录入了分数，不能删除'))
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '删除' }))
  const dlg = await screen.findByRole('dialog')
  expect(adminApi.deleteGradeExam).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认删除' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('三年一班已经录入了分数，不能删除')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('deletes after confirmation and refreshes the list', async () => {
  vi.mocked(adminApi.deleteGradeExam).mockResolvedValue(undefined)
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '删除' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(adminApi.deleteGradeExam).toHaveBeenCalledWith('ge1'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(vi.mocked(adminApi.gradeExams).mock.calls.length).toBeGreaterThan(1))
})

const fillBasics = async (name: string) => {
  const dlg = await screen.findByRole('dialog')
  fireEvent.change(within(dlg).getByLabelText('考试名称'), { target: { value: name } })
  fireEvent.change(within(dlg).getByLabelText('日期'), { target: { value: '2026-11-05' } })
  return dlg
}

it('blocks duplicate subject names in the form before calling the api', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await fillBasics('期中联考')
  fireEvent.change(within(dlg).getByLabelText('科目 2 名称'), { target: { value: ' 语文 ' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('科目名称不能重复')
  expect(adminApi.createGradeExam).not.toHaveBeenCalled()
})

it('creates a grade exam for the selected grade', async () => {
  vi.mocked(adminApi.createGradeExam).mockResolvedValue(exam({ id: 'ge2', name: '期中联考' }))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await fillBasics('期中联考')
  fireEvent.click(within(dlg).getByRole('button', { name: '期中' }))
  fireEvent.change(within(dlg).getByLabelText('科目 3 满分'), { target: { value: '120' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(adminApi.createGradeExam).toHaveBeenCalledTimes(1))
  expect(adminApi.createGradeExam).toHaveBeenCalledWith({
    grade_id: 'g3', name: '期中联考', exam_type: '期中', date: '2026-11-05',
    subjects: [{ name: '语文', full: 100 }, { name: '数学', full: 100 }, { name: '英语', full: 120 }],
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('rejects an invalid full mark and an empty name locally', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  let dlg = await screen.findByRole('dialog')
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('请填写考试名称')
  dlg = await fillBasics('期中联考')
  fireEvent.change(within(dlg).getByLabelText('科目 1 满分'), { target: { value: '0' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('满分须为 1–1000 的整数')
  expect(adminApi.createGradeExam).not.toHaveBeenCalled()
})

it('edits an exam keeping its grade and shows the backend message on 409', async () => {
  vi.mocked(adminApi.updateGradeExam).mockRejectedValue(
    new ApiError(409, 'EXAM_HAS_SCORES', '「数学」已有成绩,不能去掉', { subject: '数学' }))
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog')
  expect(within(dlg).getByLabelText('考试名称')).toHaveValue('十月联考')
  fireEvent.click(within(dlg).getByRole('button', { name: '删除科目 2' }))
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(adminApi.updateGradeExam).toHaveBeenCalledWith('ge1', {
    grade_id: 'g3', name: '十月联考', exam_type: '月考', date: '2026-10-20', subjects: [{ name: '语文', full: 100 }],
  }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('「数学」已有成绩,不能去掉')
})

it('shows the subject-naming message when lowering full below recorded scores (409)', async () => {
  vi.mocked(adminApi.updateGradeExam).mockRejectedValue(
    new ApiError(409, 'SCORE_ABOVE_FULL', '「语文」的满分不能低于已录入的最高分', { subject: '语文' }))
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog')
  fireEvent.change(within(dlg).getByLabelText('科目 1 满分'), { target: { value: '90' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('「语文」的满分不能低于已录入的最高分')
})
