import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm } from '@/shared/types/classroom'
import type { Exam } from '@/shared/types/grades'
import { classFixture, summaryFixture } from '../Classroom/pageTestUtils'
import ExamForm from './ExamForm'
import ScoresPage from './ScoresPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))

const SUBJECTS = ['语文', '数学', '英语', '道法', '科学'].map((name) => ({ name, full: 100 }))

const exam = (id: string, name: string, over: Partial<Exam> = {}): Exam => ({
  id,
  name,
  exam_type: '月考',
  date: '2026-10-20',
  subjects: SUBJECTS.slice(0, 2),
  grade_exam_id: null,
  created_by_me: true,
  progress: { entered: 10, total: 10 },
  ...over,
})
const E1 = exam('e1', '十月月考')
const E2 = exam('e2', '九月月考', { date: '2026-09-20', progress: { entered: 4, total: 10 } })

function Url() {
  const l = useLocation()
  return <p data-testid="url">{l.pathname + l.search}</p>
}

function setup(
  opts: {
    cls?: Partial<ClassView>
    perms?: ClassPerm[]
    subjects?: string[]
    exams?: Exam[]
    url?: string
  } = {},
) {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, ...opts.cls }] })
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({
      my_perms: opts.perms ?? ['exam.read', 'exam.write'],
      my_subjects: opts.subjects ?? [],
    }),
  )
  vi.mocked(examsApi.list).mockResolvedValue({ items: opts.exams ?? [E1, E2] })
  vi.mocked(examsApi.subjects).mockResolvedValue({ items: SUBJECTS })
  vi.mocked(examsApi.sheet).mockResolvedValue({ exam: E1, items: [] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: [] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/teacher/scores',
        element: (
          <>
            <ScoresPage />
            <Url />
          </>
        ),
      },
    ],
    { initialEntries: [opts.url ?? '/teacher/scores'] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client }
}

const list = async () => within(await screen.findByRole('navigation', { name: '考试列表' }))
const fillName = async (v: string) =>
  fireEvent.change(await screen.findByLabelText('考试名称'), { target: { value: v } })

beforeEach(() => {
  vi.resetAllMocks()
  useTeacherStore.setState({ classId: 'c1' })
})

it('lists exams newest first with progress', async () => {
  setup()
  const l = await list()
  const items = l.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent('十月月考')
  expect(items[0]).toHaveTextContent('已录 10/10')
  expect(items[1]).toHaveTextContent('已录 4/10')
  expect(l.getByRole('button', { name: /十月月考/ })).toHaveAttribute('aria-current', 'true')
  expect(l.getByRole('button', { name: /九月月考/ })).not.toHaveAttribute('aria-current')
})

it('creates an exam with chosen subjects and a custom one', async () => {
  setup()
  vi.mocked(examsApi.create).mockResolvedValue(exam('e3', '十一月月考'))
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await fillName('十一月月考')
  fireEvent.click(await screen.findByRole('button', { name: '道法' }))
  fireEvent.change(screen.getByLabelText('新科目名称'), { target: { value: '书法' } })
  fireEvent.change(screen.getByLabelText('新科目满分'), { target: { value: '20' } })
  fireEvent.keyDown(screen.getByLabelText('新科目满分'), { key: 'Enter' })
  expect(screen.getByLabelText('书法 满分')).toHaveValue(20)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(examsApi.create).toHaveBeenCalledTimes(1))
  expect(examsApi.create).toHaveBeenCalledWith('c1', {
    name: '十一月月考',
    exam_type: '月考',
    date: '2026-11-02',
    subjects: [
      { name: '语文', full: 100 },
      { name: '数学', full: 100 },
      { name: '英语', full: 100 },
      { name: '科学', full: 100 },
      { name: '书法', full: 20 },
    ],
  })
})

it('fill from catalog button', async () => {
  const { client } = setup()
  const spy = vi.spyOn(client, 'invalidateQueries')
  vi.mocked(examsApi.fillFromCatalog).mockResolvedValue([
    ...SUBJECTS,
    { name: '美术', full: 50 },
    { name: '音乐', full: 50 },
  ])
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await screen.findByRole('button', { name: '道法' })
  expect(screen.queryByRole('button', { name: '美术' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '从学校目录补齐' }))
  await waitFor(() => expect(examsApi.fillFromCatalog).toHaveBeenCalledWith('c1'))
  // 新科目进入可选列表(新建考试时默认选中),满分取目录值;已有的不重复
  expect(await screen.findByRole('button', { name: '美术' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByLabelText('美术 满分')).toHaveValue(50)
  expect(screen.getAllByRole('button', { name: '语文' })).toHaveLength(1)
  expect(screen.getByRole('status')).toHaveTextContent('已从学校目录补齐 2 门科目')
  expect(spy).toHaveBeenCalledWith({ queryKey: ['class-subjects', 'c1'] })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['classroom', 'c1'] })
})

it('says so when the class already has every catalog subject, and hides the button for subject teachers', async () => {
  setup()
  vi.mocked(examsApi.fillFromCatalog).mockResolvedValue(SUBJECTS)
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  fireEvent.click(await screen.findByRole('button', { name: '从学校目录补齐' }))
  expect(await screen.findByRole('status')).toHaveTextContent('班级科目已经和学校目录一致')
  expect(screen.getAllByRole('button', { name: '语文' })).toHaveLength(1)
  cleanup()

  setup({ cls: { role: 'subject_teacher' }, subjects: ['数学'] })
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await screen.findByRole('button', { name: '数学' })
  expect(screen.queryByRole('button', { name: '从学校目录补齐' })).toBeNull()
})

it('shows the error when filling from the catalog fails', async () => {
  setup()
  vi.mocked(examsApi.fillFromCatalog).mockRejectedValue(
    new ApiError(403, 'FORBIDDEN', '没有这个班的考试权限'),
  )
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  fireEvent.click(await screen.findByRole('button', { name: '从学校目录补齐' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('没有这个班的考试权限')
})

it('ignores Enter while an IME composition is in progress', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  fireEvent.change(await screen.findByLabelText('新科目名称'), { target: { value: '书法' } })
  fireEvent.keyDown(screen.getByLabelText('新科目满分'), { key: 'Enter', isComposing: true })
  expect(screen.queryByLabelText('书法 满分')).toBeNull()
})

it('limits a subject teacher to their own subjects', async () => {
  setup({
    cls: { role: 'subject_teacher' },
    subjects: ['数学'],
    exams: [exam('e1', '十月月考', { created_by_me: false })],
  })
  await list()
  expect(screen.queryByRole('button', { name: '编辑考试' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '新建考试' }))
  const form = within(await screen.findByRole('dialog'))
  expect(await form.findByRole('button', { name: '数学' })).toBeInTheDocument()
  expect(form.queryByRole('button', { name: '语文' })).toBeNull()
  expect(form.queryByRole('button', { name: '道法' })).toBeNull()
})

it('submits only the shown subjects when a subject teacher edits', async () => {
  setup({
    cls: { role: 'subject_teacher' },
    subjects: ['数学'],
    exams: [exam('e1', '十月月考', { subjects: [{ name: '数学', full: 100 }] })],
  })
  vi.mocked(examsApi.update).mockResolvedValue(E1)
  await list()
  fireEvent.click(screen.getByRole('button', { name: '编辑考试' }))
  fireEvent.change(await screen.findByLabelText('考试名称'), { target: { value: '十月月考(改)' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(examsApi.update).toHaveBeenCalledTimes(1))
  expect(examsApi.update).toHaveBeenCalledWith('c1', 'e1', {
    name: '十月月考(改)',
    exam_type: '月考',
    date: '2026-10-20',
    subjects: [{ name: '数学', full: 100 }],
  })
})

it('deletes after confirmation and clears the exam param', async () => {
  setup({ url: '/teacher/scores?exam=e2&student=s1' })
  vi.mocked(examsApi.remove).mockResolvedValue(undefined)
  await list()
  fireEvent.click(screen.getByRole('button', { name: '编辑考试' }))
  fireEvent.click(await screen.findByRole('button', { name: '删除考试' }))
  expect(examsApi.remove).not.toHaveBeenCalled()
  expect(screen.getByText('删除「九月月考」及其全部分数?')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(examsApi.remove).toHaveBeenCalledWith('c1', 'e2'))
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent('/teacher/scores?student=s1'),
  )
})

it('explains that other teachers’ subjects block deletion', async () => {
  setup()
  vi.mocked(examsApi.remove).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'))
  await list()
  fireEvent.click(screen.getByRole('button', { name: '编辑考试' }))
  fireEvent.click(await screen.findByRole('button', { name: '删除考试' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  expect(await screen.findByText('这场考试里还有其他老师负责的科目，不能删除')).toBeInTheDocument()
})

it('shows which subject is below its scores', async () => {
  setup()
  vi.mocked(examsApi.create).mockRejectedValue(
    new ApiError(400, 'FULL_BELOW_SCORES', 'x', { subject: '语文' }),
  )
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await fillName('新考试')
  fireEvent.click(await screen.findByRole('button', { name: '保存' }))
  expect(await screen.findByText('语文 的满分低于已录入的最高分')).toBeInTheDocument()
})

it('switches exams by url', async () => {
  setup({ url: '/teacher/scores?exam=e1&student=s1' })
  const l = await list()
  expect(l.getByRole('button', { name: /十月月考/ })).toHaveAttribute('aria-current', 'true')
  fireEvent.click(l.getByRole('button', { name: /九月月考/ }))
  expect(screen.getByTestId('url')).toHaveTextContent('/teacher/scores?exam=e2&student=s1')
  expect(l.getByRole('button', { name: /九月月考/ })).toHaveAttribute('aria-current', 'true')
})

it('pads the page like the other teacher pages', async () => {
  setup()
  const nav = await screen.findByRole('navigation', { name: '考试列表' })
  expect(nav.closest('.flex.flex-col.gap-4')).toHaveClass('p-4')
})

it('shows an empty state with a create action when there are no exams', async () => {
  setup({ exams: [] })
  expect(await screen.findByText('还没有考试')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '新建考试' }).length).toBeGreaterThan(0)
})

it('rejects a full score that is not an integer within 1-1000 without calling the API', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await fillName('新考试')
  const full = await screen.findByLabelText('语文 满分')
  for (const bad of ['100.5', '5000']) {
    fireEvent.change(full, { target: { value: bad } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('满分须为 1–1000 的整数')).toBeInTheDocument()
    expect(examsApi.create).not.toHaveBeenCalled()
  }
  fireEvent.change(full, { target: { value: '100' } })
  fireEvent.change(screen.getByLabelText('新科目名称'), { target: { value: '书法' } })
  fireEvent.change(screen.getByLabelText('新科目满分'), { target: { value: '1001' } })
  fireEvent.keyDown(screen.getByLabelText('新科目满分'), { key: 'Enter' })
  expect(screen.getByText('满分须为 1–1000 的整数')).toBeInTheDocument()
  expect(screen.queryByLabelText('书法 满分')).toBeNull()
})

it('shows the server message for other API errors', async () => {
  setup()
  vi.mocked(examsApi.create).mockRejectedValue(
    new ApiError(400, 'SUBJECT_NOT_ALLOWED', '只能使用你任教的科目'),
  )
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  await fillName('新考试')
  fireEvent.click(await screen.findByRole('button', { name: '保存' }))
  expect(await screen.findByText('只能使用你任教的科目')).toBeInTheDocument()
})

it('warns before removing a subject that already has scores, then submits on confirm', async () => {
  setup()
  vi.mocked(examsApi.update).mockResolvedValue(E1)
  await list()
  fireEvent.click(screen.getByRole('button', { name: '编辑考试' }))
  fireEvent.click(await screen.findByRole('button', { name: '数学' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(examsApi.update).not.toHaveBeenCalled()
  expect(screen.getByText('去掉「数学」会同时删除该科已录的分数')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(examsApi.update).toHaveBeenCalledTimes(1))
  expect(vi.mocked(examsApi.update).mock.calls[0][2].subjects).toEqual([
    { name: '语文', full: 100 },
  ])
})

it('limits the new subject name to 10 characters', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '新建考试' }))
  expect(await screen.findByLabelText('新科目名称')).toHaveAttribute('maxlength', '10')
})

const LINKED = exam('e9', '十一月联考', { date: '2026-11-03', grade_exam_id: 'ge1' })
const MANAGED_HINT = '这是年级联考,由教导处修改'

it('tags a grade exam in the list and hides edit and delete for it', async () => {
  setup({ exams: [LINKED, E1] })
  const l = await list()
  expect(l.getByRole('button', { name: /十一月联考/ })).toHaveTextContent('年级联考')
  expect(l.getByRole('button', { name: /十月月考/ })).not.toHaveTextContent('年级联考')
  expect(screen.queryByRole('button', { name: '编辑考试' })).toBeNull()
  expect(screen.queryByRole('button', { name: '删除考试' })).toBeNull()
  expect(screen.getByText(MANAGED_HINT)).toBeInTheDocument()
  // 换到普通考试,编辑入口回来、提示消失
  fireEvent.click(l.getByRole('button', { name: /十月月考/ }))
  expect(await screen.findByRole('button', { name: '编辑考试' })).toBeInTheDocument()
  expect(screen.queryByText(MANAGED_HINT)).toBeNull()
})

it('marks a grade exam in the narrow select too', async () => {
  setup({ exams: [LINKED, E1] })
  await list()
  expect(
    screen.getByRole('option', { name: '十一月联考(2026-11-03) · 年级联考' }),
  ).toBeInTheDocument()
})

it('refuses to open the edit form for a grade exam', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(examsApi.subjects).mockResolvedValue({ items: SUBJECTS })
  render(
    <QueryClientProvider client={client}>
      <ExamForm
        classId="c1"
        exam={LINKED}
        today="2026-11-04"
        mySubjects={[]}
        canAllSubjects
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  )
  const dlg = within(await screen.findByRole('dialog'))
  expect(dlg.getByText(MANAGED_HINT)).toBeInTheDocument()
  expect(dlg.queryByRole('button', { name: '保存' })).toBeNull()
  expect(dlg.queryByRole('button', { name: '删除考试' })).toBeNull()
  expect(dlg.queryByLabelText('考试名称')).toBeNull()
})
