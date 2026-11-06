import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { schoolApi } from '@/shared/api/school'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { DEFAULT_GRADING } from '@/shared/lib/grades'
import { confirmLeave, useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { Exam, ScoreSheet } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import ScoresPage from './ScoresPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/school', () => ({ schoolApi: { grading: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const EXAM: Exam = {
  id: 'e1',
  name: '十月月考',
  exam_type: '月考',
  date: '2026-10-20',
  subjects: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  grade_exam_id: null,
  created_by_me: true,
  progress: { entered: 3, total: 3 },
}
// e1 王小一 80/70;e2 李小二 50/缺考;e3 张小三 无记录
const SHEET: ScoreSheet = {
  exam: EXAM,
  items: [
    { enrollment_id: 'e1', scores: { 语文: 80, 数学: 70 } },
    { enrollment_id: 'e2', scores: { 语文: 50, 数学: null } },
  ],
}

function setup(
  opts: {
    cls?: Partial<ClassView>
    subjects?: string[]
    sheet?: ScoreSheet
    roster?: StudentSeat[]
  } = {},
) {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, ...opts.cls }] })
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({
      my_perms: ['exam.read', 'exam.write', 'score.write'],
      my_subjects: opts.subjects ?? [],
    }),
  )
  vi.mocked(examsApi.list).mockResolvedValue({ items: [EXAM] })
  vi.mocked(examsApi.sheet).mockResolvedValue(opts.sheet ?? SHEET)
  vi.mocked(examsApi.saveScores).mockResolvedValue({ updated: 1 })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: opts.roster ?? rosterFixture })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/teacher/scores',
        element: (
          <>
            <Link to="/teacher/analysis">分析</Link>
            <ScoresPage />
          </>
        ),
      },
      { path: '/teacher/analysis', element: <p>分析页</p> },
    ],
    { initialEntries: ['/teacher/scores'] },
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, unmount: view.unmount }
}

const cell = async (name: string, subject: string) =>
  (await screen.findByLabelText(`${name} ${subject}`)) as HTMLInputElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const sent = () => vi.mocked(examsApi.saveScores).mock.calls
const ms = (n: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(n)
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(schoolApi.grading).mockResolvedValue(DEFAULT_GRADING)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  useTeacherStore.setState({ classId: 'c1', unsaved: { seating: false, scores: false } })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('moves with Enter, arrows and Shift+Enter', async () => {
  setup()
  const a = await cell('王小一', '语文')
  fireEvent.focus(a)
  fireEvent.keyDown(a, { key: 'Enter' })
  const b = await cell('李小二', '语文')
  expect(b).toHaveFocus()
  fireEvent.keyDown(b, { key: 'Enter', shiftKey: true })
  expect(a).toHaveFocus()
  fireEvent.keyDown(a, { key: 'ArrowDown' })
  expect(b).toHaveFocus()
  fireEvent.keyDown(b, { key: 'ArrowUp' })
  expect(a).toHaveFocus()
  // 光标不在末尾时 → 不跳列;在末尾才跳
  a.setSelectionRange(0, 0)
  fireEvent.keyDown(a, { key: 'ArrowRight' })
  expect(a).toHaveFocus()
  a.setSelectionRange(2, 2)
  fireEvent.keyDown(a, { key: 'ArrowRight' })
  const m = await cell('王小一', '数学')
  expect(m).toHaveFocus()
  m.setSelectionRange(1, 1)
  fireEvent.keyDown(m, { key: 'ArrowLeft' })
  expect(m).toHaveFocus()
  m.setSelectionRange(0, 0)
  fireEvent.keyDown(m, { key: 'ArrowLeft' })
  expect(a).toHaveFocus()
  // 输入法组合中不处理
  fireEvent.keyDown(a, { key: 'Enter', isComposing: true })
  expect(a).toHaveFocus()
})

it('marks absent, low and over-full cells and does not queue invalid ones', async () => {
  setup()
  const absent = await cell('李小二', '数学')
  expect(absent).toHaveValue('缺考')
  expect(absent.className).toContain('bg-warning')
  expect((await cell('李小二', '语文')).className).toContain('text-destructive')
  const c = await cell('张小三', '语文')
  type(c, '120')
  expect(c.className).toContain('bg-destructive')
  expect(c).toHaveAttribute('title', expect.stringContaining('满分'))
  type(c, 'abc')
  expect(c).toHaveAttribute('title', expect.stringContaining('格式'))
  await ms(1000)
  expect(sent()).toHaveLength(0)
  type(c, '88')
  expect(c).not.toHaveAttribute('title')
  await ms(700)
  expect(sent()).toHaveLength(1)
  expect(sent()[0][2]).toEqual([{ enrollment_id: 'e3', subject: '语文', value: 88 }])
})

it('pastes a block with blanks without shifting and skips cells outside the grid', async () => {
  setup()
  const start = await cell('王小一', '语文')
  fireEvent.paste(start, { clipboardData: { getData: () => '90\t\t77\n\n缺考\t60' } })
  expect(start).toHaveValue('90')
  expect(await cell('王小一', '数学')).toHaveValue('70')
  expect(await cell('李小二', '语文')).toHaveValue('50')
  expect(await cell('张小三', '语文')).toHaveValue('缺考')
  expect(await cell('张小三', '数学')).toHaveValue('60')
  expect(toast).toHaveBeenCalledWith('已粘贴 3 格,1 格在表格外或不可编辑,已跳过')
  await ms(700)
  expect(sent()).toHaveLength(1)
  expect(sent()[0][2]).toHaveLength(3)
})

it('batches edits within 600ms into one request', async () => {
  setup()
  type(await cell('王小一', '语文'), '91')
  await ms(300)
  type(await cell('李小二', '语文'), '92')
  type(await cell('张小三', '数学'), '93')
  await ms(500)
  expect(sent()).toHaveLength(0)
  await ms(200)
  expect(sent()).toHaveLength(1)
  expect(sent()[0][2]).toHaveLength(3)
  expect(await screen.findByText('已保存')).toBeInTheDocument()
})

it('keeps failed cells and retries them', async () => {
  setup()
  vi.mocked(examsApi.saveScores).mockRejectedValueOnce(new Error('boom'))
  type(await cell('王小一', '语文'), '91')
  type(await cell('李小二', '语文'), '92')
  type(await cell('张小三', '数学'), '93')
  await ms(700)
  expect(await screen.findByText('保存失败')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(sent()).toHaveLength(2))
  expect(sent()[1][2]).toEqual(sent()[0][2])
  expect(sent()[1][2]).toHaveLength(3)
  expect(await screen.findByText('已保存')).toBeInTheDocument()
})

it('blocks navigation while changes are unsaved', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { router } = setup()
  type(await cell('王小一', '语文'), '91')
  fireEvent.click(screen.getByRole('link', { name: '分析' }))
  expect(confirmSpy).toHaveBeenCalledWith('还有成绩没保存,确定离开?')
  expect(router.state.location.pathname).toBe('/teacher/scores')
  confirmSpy.mockReturnValue(true)
  fireEvent.click(screen.getByRole('link', { name: '分析' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/teacher/analysis'))
  // 离开时没发出去的改动立即发送
  await waitFor(() => expect(sent()).toHaveLength(1))
})

it('mirrors unsaved edits into the teacher store and clears it when saved', async () => {
  setup()
  expect(useTeacherStore.getState().unsaved.scores).toBe(false)
  type(await cell('王小一', '语文'), '91')
  expect(useTeacherStore.getState().unsaved.scores).toBe(true)
  await ms(700)
  expect(await screen.findByText('已保存')).toBeInTheDocument()
  expect(useTeacherStore.getState().unsaved.scores).toBe(false)
})

it('clears the store flag when the grid unmounts', async () => {
  const { unmount } = setup()
  type(await cell('王小一', '语文'), '91')
  expect(useTeacherStore.getState().unsaved.scores).toBe(true)
  unmount()
  expect(useTeacherStore.getState().unsaved.scores).toBe(false)
})

it('asks only once when a header confirm is followed by navigation', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { router } = setup()
  type(await cell('王小一', '语文'), '91')
  // 顶栏退出登录:先 confirmLeave(),再 navigate('/login')
  expect(confirmLeave()).toBe(true)
  await act(async () => {
    await router.navigate('/teacher/analysis')
  })
  expect(router.state.location.pathname).toBe('/teacher/analysis')
  expect(confirmSpy).toHaveBeenCalledTimes(1)
})

it('keeps headers and identity cells on one line so narrow screens scroll instead of squeezing', async () => {
  setup()
  const c = await cell('王小一', '语文')
  const tr = c.closest('tr') as HTMLElement
  for (const h of screen.getAllByRole('columnheader')) expect(h).toHaveClass('whitespace-nowrap')
  const cells = within(tr)
  for (const el of [
    cells.getByText('王小一'),
    cells.getByTestId('total'),
    cells.getByTestId('rank'),
  ])
    expect(el).toHaveClass('whitespace-nowrap')
  expect(tr.querySelector('td')).toHaveClass('whitespace-nowrap')
})

it('updates totals and ranks as you type', async () => {
  setup()
  const row = async (name: string) =>
    within((await cell(name, '语文')).closest('tr') as HTMLElement)
  expect((await row('王小一')).getByTestId('total')).toHaveTextContent('150')
  expect((await row('王小一')).getByTestId('rank')).toHaveTextContent('1')
  expect((await row('张小三')).getByTestId('rank')).toHaveTextContent('—')
  type(await cell('张小三', '语文'), '95')
  type(await cell('张小三', '数学'), '99')
  expect((await row('张小三')).getByTestId('total')).toHaveTextContent('194')
  expect((await row('张小三')).getByTestId('rank')).toHaveTextContent('1')
  expect((await row('王小一')).getByTestId('rank')).toHaveTextContent('2')
})

it('makes other subjects read-only for a subject teacher', async () => {
  setup({ cls: { role: 'subject_teacher' }, subjects: ['数学'] })
  expect(await cell('王小一', '语文')).toHaveAttribute('readonly')
  expect(await cell('王小一', '数学')).not.toHaveAttribute('readonly')
  type(await cell('王小一', '语文'), '1')
  await ms(1000)
  expect(sent()).toHaveLength(0)
})

it('never saves an earlier keystroke when the final text is over-full or invalid', async () => {
  setup()
  const c = await cell('张小三', '语文')
  const d = await cell('张小三', '数学')
  for (const v of ['1', '10', '105']) type(c, v)
  expect(c.className).toContain('bg-destructive')
  expect(within(c.closest('tr') as HTMLElement).getByTestId('total')).toHaveTextContent('—')
  await ms(1000)
  expect(sent()).toHaveLength(0)
  // 粘贴走同一条路径:先入队合法值,再被超分值覆盖
  type(d, '60')
  fireEvent.paste(d, { clipboardData: { getData: () => '500\n' } })
  await ms(1000)
  expect(sent()).toHaveLength(0)
  expect(within(d.closest('tr') as HTMLElement).getByTestId('total')).toHaveTextContent('—')
})

it('sorts students by numeric student number', async () => {
  const seat = (n: number, name: string, no: string): StudentSeat => ({
    ...rosterFixture[0],
    enrollment_id: `e${n}`,
    student_id: `s${n}`,
    name,
    student_no: no,
  })
  setup({ roster: [seat(1, '王小一', '10'), seat(2, '李小二', '2'), seat(3, '张小三', '1')] })
  await cell('王小一', '语文')
  const order = screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent)
  expect(order).toEqual(['1', '2', '10'])
})

it('sends cells whose save failed when the grid unmounts', async () => {
  const { unmount } = setup()
  vi.mocked(examsApi.saveScores).mockRejectedValueOnce(new Error('boom'))
  type(await cell('王小一', '语文'), '91')
  await ms(700)
  expect(await screen.findByText('保存失败')).toBeInTheDocument()
  expect(sent()).toHaveLength(1)
  unmount()
  await waitFor(() => expect(sent()).toHaveLength(2))
  expect(sent()[1][2]).toEqual([{ enrollment_id: 'e1', subject: '语文', value: 91 }])
})

it('does not stay stuck on failed when the only in-flight cell was discarded', async () => {
  setup()
  let fail: (e: Error) => void = () => {}
  vi.mocked(examsApi.saveScores).mockImplementationOnce(
    () =>
      new Promise((_, rej) => {
        fail = rej
      }),
  )
  const a = await cell('王小一', '语文')
  type(a, '91')
  await ms(700)
  expect(sent()).toHaveLength(1)
  type(a, 'abc')
  await act(async () => {
    fail(new Error('boom'))
  })
  await ms(10)
  expect(screen.queryByText('保存失败')).toBeNull()
})
