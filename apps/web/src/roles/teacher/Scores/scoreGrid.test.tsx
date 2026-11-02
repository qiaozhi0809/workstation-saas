import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { Exam, ScoreSheet } from '@/shared/types/grades'
import { ALL_PERMS, classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import ScoresPage from './ScoresPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const EXAM: Exam = {
  id: 'e1', name: '十月月考', exam_type: '月考', date: '2026-10-20',
  subjects: [{ name: '语文', full: 100 }, { name: '数学', full: 100 }],
  created_by_me: true, progress: { entered: 3, total: 3 },
}
// e1 王小一 80/70;e2 李小二 50/缺考;e3 张小三 无记录
const SHEET: ScoreSheet = {
  exam: EXAM,
  items: [
    { enrollment_id: 'e1', scores: { 语文: 80, 数学: 70 } },
    { enrollment_id: 'e2', scores: { 语文: 50, 数学: null } },
  ],
}

function setup(opts: { cls?: Partial<ClassView>; subjects?: string[]; sheet?: ScoreSheet } = {}) {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, ...opts.cls }] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({
    my_perms: [...ALL_PERMS, 'exam.read', 'exam.write', 'score.write'], my_subjects: opts.subjects ?? [],
  }))
  vi.mocked(examsApi.list).mockResolvedValue({ items: [EXAM] })
  vi.mocked(examsApi.sheet).mockResolvedValue(opts.sheet ?? SHEET)
  vi.mocked(examsApi.saveScores).mockResolvedValue({ updated: 1 })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/teacher/scores', element: <><Link to="/teacher/analysis">分析</Link><ScoresPage /></> },
    { path: '/teacher/analysis', element: <p>分析页</p> },
  ], { initialEntries: ['/teacher/scores'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { router }
}

const cell = async (name: string, subject: string) =>
  (await screen.findByLabelText(`${name} ${subject}`)) as HTMLInputElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const sent = () => vi.mocked(examsApi.saveScores).mock.calls
const ms = (n: number) => act(async () => { await vi.advanceTimersByTimeAsync(n) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  useTeacherStore.setState({ classId: 'c1' })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

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
  expect(toast).toHaveBeenCalledWith('已粘贴 3 格')
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

it('updates totals and ranks as you type', async () => {
  setup()
  const row = async (name: string) => within((await cell(name, '语文')).closest('tr') as HTMLElement)
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
