import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { toast } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import type { BoardView, GradeAdmin, GradeExam } from '@/shared/types/admin'
import type { Meta, SubjectCatalog } from '@/shared/types/school'
import GradeExamsPage from './GradeExamsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    grades: vi.fn(),
    board: vi.fn(),
    gradeExams: vi.fn(),
    createGradeExam: vi.fn(),
    updateGradeExam: vi.fn(),
    deleteGradeExam: vi.fn(),
    syncGradeExam: vi.fn(),
  },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { subjectCatalog: vi.fn(), meta: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const META: Meta = { version: '1.0.0', school_name: '示例小学', school_tz: 'Asia/Shanghai' }

const CATALOG: SubjectCatalog = {
  primary: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
    { name: '英语', full: 100 },
    { name: '科学', full: 100 },
  ],
  junior: [
    { name: '语文', full: 120 },
    { name: '物理', full: 100 },
  ],
  senior: [{ name: '语文', full: 150 }],
}

const boardOf = (...grades: { id: string; name: string }[]): BoardView => ({
  grades,
  grade_id: null,
  classes: [],
})
const G3 = { id: 'g3', name: '三年级' }
const G4 = { id: 'g4', name: '四年级' }

const exam = (over: Partial<GradeExam> = {}): GradeExam => ({
  id: 'ge1',
  grade_id: 'g3',
  grade_name: '三年级',
  name: '十月联考',
  exam_type: '月考',
  date: '2026-10-20',
  subjects: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  classes: [
    { class_id: 'c1', class_name: '三年一班', exam_id: 'e1', entered: 20, expected: 40 },
    { class_id: 'c2', class_name: '三年二班', exam_id: 'e2', entered: 40, expected: 40 },
  ],
  missing_classes: [],
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ user: null })
  vi.mocked(adminApi.board).mockResolvedValue(boardOf(G3, G4))
  vi.mocked(adminApi.gradeExams).mockImplementation(async (gid) => (gid === 'g4' ? [] : [exam()]))
  vi.mocked(schoolApi.subjectCatalog).mockResolvedValue(CATALOG)
  vi.mocked(schoolApi.meta).mockResolvedValue(META)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

let client: QueryClient
const renderPage = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GradeExamsPage />
      </MemoryRouter>
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
  expect(r.getByRole('progressbar', { name: '三年一班 录分进度' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  )
  expect(r.getByRole('link', { name: '查看汇总' })).toHaveAttribute(
    'href',
    '/admin/reports/scores?exam=ge1',
  )

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

it('toasts the backend message when sync fails (L41)', async () => {
  vi.mocked(adminApi.gradeExams).mockResolvedValue([
    exam({ missing_classes: [{ class_id: 'c3', class_name: '三年三班' }] }),
  ])
  vi.mocked(adminApi.syncGradeExam).mockRejectedValue(
    new ApiError(409, 'NO_ACTIVE_YEAR', '学年已变动,请刷新'),
  )
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '补建' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('学年已变动,请刷新'))
  expect(toast).not.toHaveBeenCalledWith('已补建')
  // 失败后按钮恢复可用,能再试一次
  expect(within(row()).getByRole('button', { name: '补建' })).toBeEnabled()
})

// 老师端的考试列表 / 成绩册 / 班级科目表查询键(与 roles/teacher 下的 useQuery 写法一致);
// 成绩单键 ['score-sheet', classId, examId] 还带该班对应考试的 id
const TEACHER_KEYS = ['exams', 'gradebook', 'class-subjects']
const expectTeacherCachesInvalidated = (
  spy: MockInstance<QueryClient['invalidateQueries']>,
  classes: Record<string, string>, // classId → examId
  untouched: string[] = [],
) => {
  for (const [cid, eid] of Object.entries(classes)) {
    for (const k of TEACHER_KEYS) expect(spy).toHaveBeenCalledWith({ queryKey: [k, cid] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['score-sheet', cid, eid] })
  }
  for (const cid of untouched) {
    for (const k of TEACHER_KEYS) expect(spy).not.toHaveBeenCalledWith({ queryKey: [k, cid] })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['score-sheet', cid]) })
  }
}

it('invalidates the teacher caches of every class that got the exam after creating (L41)', async () => {
  vi.mocked(adminApi.createGradeExam).mockResolvedValue(exam({ id: 'ge2', name: '期中联考' }))
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await fillBasics('期中联考')
  await within(dlg).findByRole('checkbox', { name: '语文' })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expectTeacherCachesInvalidated(spy, { c1: 'e1', c2: 'e2' }, ['c3'])
  expect(spy).toHaveBeenCalledWith({ queryKey: ['grade-exams'] })
})

it('invalidates the teacher caches of the classes before and after an edit (L41)', async () => {
  // 编辑前有 c1、c2;编辑后的返回里多了 c3(同时补建了班)——两边都要失效
  vi.mocked(adminApi.updateGradeExam).mockResolvedValue(
    exam({
      classes: [
        { class_id: 'c1', class_name: '三年一班', exam_id: 'e1', entered: 20, expected: 40 },
        { class_id: 'c3', class_name: '三年三班', exam_id: 'e3', entered: 0, expected: 40 },
      ],
    }),
  )
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(within(row()).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog')
  await within(dlg).findByRole('checkbox', { name: '语文' })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // 编辑前的 c2/e2 与编辑后的 c3/e3 都要失效
  expectTeacherCachesInvalidated(spy, { c1: 'e1', c2: 'e2', c3: 'e3' })
})

it('invalidates the teacher caches of the deleted exam classes (L41)', async () => {
  vi.mocked(adminApi.deleteGradeExam).mockResolvedValue(undefined)
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(within(row()).getByRole('button', { name: '删除' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expectTeacherCachesInvalidated(spy, { c1: 'e1', c2: 'e2' }, ['c3'])
})

it('invalidates the teacher caches of the classes returned by sync (L41)', async () => {
  vi.mocked(adminApi.gradeExams).mockResolvedValue([
    exam({ missing_classes: [{ class_id: 'c3', class_name: '三年三班' }] }),
  ])
  vi.mocked(adminApi.syncGradeExam).mockResolvedValue(
    exam({
      classes: [
        ...exam().classes,
        { class_id: 'c3', class_name: '三年三班', exam_id: 'e3', entered: 0, expected: 40 },
      ],
    }),
  )
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(within(row()).getByRole('button', { name: '补建' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已补建'))
  expectTeacherCachesInvalidated(spy, { c1: 'e1', c2: 'e2', c3: 'e3' })
})

it('defaults the date of a new exam to today in the school time zone (L41 / L43)', async () => {
  // 2026-11-04 16:30 UTC:上海已经是 11-05 00:30,UTC−12 … UTC+7 的浏览器还在 11-04
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T16:30:00Z'))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await screen.findByRole('dialog')
  expect(within(dlg).getByLabelText('日期')).toHaveValue('2026-11-05')
})

it('shows the backend message when delete is rejected with 409', async () => {
  vi.mocked(adminApi.deleteGradeExam).mockRejectedValue(
    new ApiError(409, 'EXAM_HAS_SCORES', '三年一班已经录入了分数，不能删除'),
  )
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '删除' }))
  const dlg = await screen.findByRole('dialog')
  expect(adminApi.deleteGradeExam).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认删除' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent(
    '三年一班已经录入了分数，不能删除',
  )
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
const subjectBoxes = (dlg: HTMLElement) =>
  within(within(dlg).getByRole('group', { name: '科目' })).getAllByRole('checkbox')
const subjectRow = (dlg: HTMLElement, name: string) =>
  within(dlg).getByRole('checkbox', { name }).closest('li') as HTMLElement

it('grade exam form picks from catalog', async () => {
  vi.mocked(adminApi.createGradeExam).mockResolvedValue(exam({ id: 'ge2', name: '期中联考' }))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await fillBasics('期中联考')
  // 三年级 → 小学目录,全部默认勾上,满分只读显示目录值,没有自由输入框
  await within(dlg).findByRole('checkbox', { name: '语文' })
  expect(schoolApi.subjectCatalog).toHaveBeenCalledTimes(1)
  expect(subjectBoxes(dlg).map((b) => b.getAttribute('aria-label'))).toEqual([
    '语文',
    '数学',
    '英语',
    '科学',
  ])
  expect(subjectBoxes(dlg).every((b) => (b as HTMLInputElement).checked)).toBe(true)
  expect(within(dlg).getByText('小学目录')).toBeInTheDocument()
  expect(subjectRow(dlg, '科学')).toHaveTextContent('满分 100')
  expect(within(dlg).queryByLabelText('科目 1 名称')).toBeNull()
  expect(within(dlg).queryByRole('button', { name: '添加科目' })).toBeNull()

  fireEvent.click(within(dlg).getByRole('checkbox', { name: '英语' }))
  fireEvent.click(within(dlg).getByRole('button', { name: '期中' }))
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(adminApi.createGradeExam).toHaveBeenCalledTimes(1))
  expect(adminApi.createGradeExam).toHaveBeenCalledWith({
    grade_id: 'g3',
    name: '期中联考',
    exam_type: '期中',
    date: '2026-11-05',
    subjects: [
      { name: '语文', full: 100 },
      { name: '数学', full: 100 },
      { name: '科学', full: 100 },
    ],
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('uses the stage of the grade: junior catalog for 初一 by name, explicit stage when readable', async () => {
  vi.mocked(adminApi.board).mockResolvedValue(boardOf({ id: 'g7', name: '初一' }))
  vi.mocked(adminApi.gradeExams).mockResolvedValue([exam({ grade_id: 'g7', grade_name: '初一' })])
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  let dlg = await screen.findByRole('dialog')
  await within(dlg).findByRole('checkbox', { name: '物理' })
  expect(within(dlg).getByText('初中目录')).toBeInTheDocument()
  expect(subjectRow(dlg, '语文')).toHaveTextContent('满分 120')
  expect(adminApi.grades).not.toHaveBeenCalled() // 没有 org.manage 不去读年级表
  fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // 有 org.manage:年级表里显式设的学段优先于按名字推断
  useAuthStore.setState({ user: { admin_perms: ['org.manage'] } as never })
  const g7: GradeAdmin = {
    id: 'g7',
    name: '初一',
    stage: '高中',
    effective_stage: '高中',
    display_order: 1,
    class_count: 2,
  }
  vi.mocked(adminApi.grades).mockResolvedValue([g7])
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  dlg = await screen.findByRole('dialog')
  expect(await within(dlg).findByText('高中目录')).toBeInTheDocument()
  expect(subjectRow(dlg, '语文')).toHaveTextContent('满分 150')
  expect(within(dlg).queryByRole('checkbox', { name: '物理' })).toBeNull()
})

it('requires a name and at least one subject locally', async () => {
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  let dlg = await screen.findByRole('dialog')
  // 目录没加载完之前不能保存
  expect(within(dlg).getByRole('button', { name: '保存' })).toBeDisabled()
  await within(dlg).findByRole('checkbox', { name: '语文' })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('请填写考试名称')
  dlg = await fillBasics('期中联考')
  for (const b of subjectBoxes(dlg)) fireEvent.click(b)
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('至少选择一个科目')
  expect(adminApi.createGradeExam).not.toHaveBeenCalled()
})

it('shows the SUBJECT_NOT_IN_CATALOG message from the backend in the form', async () => {
  vi.mocked(adminApi.createGradeExam).mockRejectedValue(
    new ApiError(400, 'SUBJECT_NOT_IN_CATALOG', '「科学」不在三年级的科目目录里', {
      subject: '科学',
    }),
  )
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await fillBasics('期中联考')
  await within(dlg).findByRole('checkbox', { name: '语文' })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('「科学」不在三年级的科目目录里')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('edits an exam: keeps its grade and full marks, lists legacy subjects, shows the 409 message', async () => {
  vi.mocked(adminApi.updateGradeExam).mockRejectedValue(
    new ApiError(409, 'EXAM_HAS_SCORES', '「数学」已有成绩,不能去掉', { subject: '数学' }),
  )
  vi.mocked(adminApi.gradeExams).mockResolvedValue([
    exam({
      subjects: [
        { name: '语文', full: 90 },
        { name: '数学', full: 100 },
        { name: '道法', full: 50 },
      ],
    }),
  ])
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog')
  expect(within(dlg).getByLabelText('考试名称')).toHaveValue('十月联考')
  await within(dlg).findByRole('checkbox', { name: '语文' })
  // 考试里已有的科目按考试里的满分;目录里有但考试没有的默认不勾;不在目录里的旧科目保留并标注
  expect(subjectBoxes(dlg).map((b) => b.getAttribute('aria-label'))).toEqual([
    '语文',
    '数学',
    '英语',
    '科学',
    '道法',
  ])
  expect(within(dlg).getByRole('checkbox', { name: '语文' })).toBeChecked()
  expect(within(dlg).getByRole('checkbox', { name: '英语' })).not.toBeChecked()
  expect(within(dlg).getByRole('checkbox', { name: '道法' })).toBeChecked()
  expect(subjectRow(dlg, '语文')).toHaveTextContent('满分 90')
  expect(subjectRow(dlg, '道法')).toHaveTextContent('已不在目录')
  fireEvent.click(within(dlg).getByRole('checkbox', { name: '数学' }))
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(adminApi.updateGradeExam).toHaveBeenCalledWith('ge1', {
      grade_id: 'g3',
      name: '十月联考',
      exam_type: '月考',
      date: '2026-10-20',
      subjects: [
        { name: '语文', full: 90 },
        { name: '道法', full: 50 },
      ],
    }),
  )
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('「数学」已有成绩,不能去掉')
})

it('edits an exam: keeps the exam subject order and appends newly picked subjects', async () => {
  const existing = exam({
    subjects: [
      { name: '数学', full: 100 },
      { name: '语文', full: 90 },
    ],
  })
  vi.mocked(adminApi.gradeExams).mockResolvedValue([existing])
  vi.mocked(adminApi.updateGradeExam).mockResolvedValue(existing)
  await renderPage()
  fireEvent.click(within(row()).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog')
  // 复选框仍按目录序展示
  await within(dlg).findByRole('checkbox', { name: '语文' })
  expect(subjectBoxes(dlg).map((b) => b.getAttribute('aria-label'))).toEqual([
    '语文',
    '数学',
    '英语',
    '科学',
  ])
  fireEvent.click(within(dlg).getByRole('checkbox', { name: '英语' }))
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(adminApi.updateGradeExam).toHaveBeenCalledWith('ge1', {
      grade_id: 'g3',
      name: '十月联考',
      exam_type: '月考',
      date: '2026-10-20',
      subjects: [
        { name: '数学', full: 100 },
        { name: '语文', full: 90 },
        { name: '英语', full: 100 },
      ],
    }),
  )
})

it('tells when the catalog cannot be loaded instead of offering free text', async () => {
  vi.mocked(schoolApi.subjectCatalog).mockRejectedValue(new ApiError(500, 'X', '失败'))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '新建联考' }))
  const dlg = await screen.findByRole('dialog')
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('科目目录加载失败')
  expect(within(dlg).queryByRole('checkbox')).toBeNull()
  expect(within(dlg).getByRole('button', { name: '保存' })).toBeDisabled()
})
