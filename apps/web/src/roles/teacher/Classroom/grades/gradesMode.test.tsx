import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { examsApi } from '@/shared/api/exams'
import { GRADE_TINTS } from '@/shared/components/ClassroomMap/art/palette'
import type { GradebookExam } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { defaultApiMocks, setup } from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')
vi.mock('@/shared/api/exams')

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

const NAMES = ['王小一', '李小二', '张小三', '赵小四', '钱小五', '孙小六', '周小七', '吴小八', '郑小九', '冯小十']
// 3 行 4 列:前 4 人第 1 排,接着第 2 排,最后两人第 3 排
const roster: StudentSeat[] = NAMES.map((name, i) => ({
  enrollment_id: `e${i + 1}`, student_id: `s${i + 1}`, name, mk: `S${i + 1}`,
  seat_row: Math.floor(i / 4) + 1, seat_col: (i % 4) + 1, avatar_seed: null, gender: '男',
  student_no: `${i + 1}`, birthdate: null, class_role: null, seat_locked: false,
}))

function exam(id: string, date: string, ranks: Record<string, number> | null): GradebookExam {
  return {
    id, name: `考试${id}`, exam_type: '月考', date, subjects: [{ name: '语文', full: 100 }],
    created_by_me: true, progress: { entered: 10, total: 10 },
    scores: ranks ? Object.fromEntries(Object.entries(ranks).map(([e, r]) => [e, { 语文: 101 - r }])) : {},
  }
}
// 上次名次:e1=1 e2=8 e3=2 e4=3 e5=4 e6=9 e7=5 e8=6 e9=7 e10=10
const PREV = { e1: 1, e2: 8, e3: 2, e4: 3, e5: 4, e6: 9, e7: 5, e8: 6, e9: 7, e10: 10 }
// 本次名次:e2 升 6 名、e1 降 5 名、e6 升 4 名(无角标)
const CUR = { e1: 6, e2: 2, e3: 1, e4: 3, e5: 4, e6: 5, e7: 7, e8: 8, e9: 9, e10: 10 }
const book = () => ({ exams: [exam('e1', '2026-09-20', PREV), exam('e2', '2026-10-20', CUR)] })

const tops = (c: HTMLElement) => Array.from(c.querySelectorAll('.cr-desk')).map((d) => d.querySelector('rect')!.getAttribute('fill'))

it('shows the grades tab only with exam.read', async () => {
  setup({ perms: ['attendance.read'] })
  await screen.findByRole('tab', { name: '日常' })
  expect(screen.queryByRole('tab', { name: '成绩' })).toBeNull()
})

it('puts the grades tab between 点评 and 排座', async () => {
  setup({ perms: ['review.read', 'exam.read', 'seating.write'] })
  await screen.findByRole('tab', { name: '日常' })
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常', '点评', '成绩', '排座'])
})

it('tints seats by rank fifths and badges big moves', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue(book())
  const { container } = setup({ mode: '成绩', roster })
  expect(await screen.findByRole('button', { name: '李小二，第1排第2列，#2 ↑6' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '王小一，第1排第1列，#6 ↓5' })).toBeInTheDocument()
  // 进退 4 名、1 名都没有角标
  expect(screen.getByRole('button', { name: '孙小六，第2排第2列' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '张小三，第1排第3列' })).toBeInTheDocument()
  // 名次 1-2 → 1 档 … 9-10 → 5 档(本次名次 CUR)
  const byRank = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => Object.keys(CUR).find((k) => CUR[k as keyof typeof CUR] === r)!)
  const expected = byRank.map((_, i) => GRADE_TINTS[(Math.floor(i / 2) + 1) as 1 | 2 | 3 | 4 | 5])
  const filled = tops(container)
  const cellOf = (id: string) => Number(id.slice(1)) - 1 // 4 列,学生 n 恰在第 n 格
  byRank.forEach((id, i) => expect(filled[cellOf(id)]).toBe(expected[i]))
  expect(screen.getByText('前 20%')).toBeInTheDocument()
  expect(screen.getByText('后 20%')).toBeInTheDocument()
})

it('dims students without scores', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [exam('e1', '2026-09-20', { e1: 1 })] })
  const { container } = setup({ mode: '成绩', roster })
  expect(await screen.findByRole('button', { name: '李小二，第1排第2列，无成绩' })).toBeInTheDocument()
  expect(container.querySelector('[data-enrollment="e2"]')).toHaveAttribute('data-ghost', 'true')
  expect(container.querySelector('[data-enrollment="e1"]')).not.toHaveAttribute('data-ghost')
  expect(tops(container)[0]).toBe(GRADE_TINTS[1])
  expect(tops(container)[1]).not.toBe(GRADE_TINTS[1])
})

it('opens the scores tab from a seat but not while presenting', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue(book())
  setup({ mode: '成绩', roster })
  fireEvent.click(await screen.findByRole('button', { name: /^李小二，/ }))
  await vi.waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('student=s2&tab=%E6%88%90%E7%BB%A9'))
})

it('does not open the profile from a seat while presenting', async () => {
  const request = Element.prototype.requestFullscreen
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  try {
    vi.mocked(examsApi.gradebook).mockResolvedValue(book())
    const { container } = setup({ mode: '成绩', roster })
    await screen.findByRole('button', { name: /^李小二，/ })
    fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
    await screen.findByRole('button', { name: '退出全屏' })
    expect(screen.queryByRole('button', { name: /^李小二，/ })).toBeNull()
    fireEvent.click(container.querySelector('[data-enrollment="e2"]')!)
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom\?mode=grades$/)
  } finally {
    Element.prototype.requestFullscreen = request
    delete (document as { fullscreenElement?: Element | null }).fullscreenElement
  }
})

it('links to the full analysis of the chosen exam', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue(book())
  setup({ mode: '成绩', roster })
  const link = await screen.findByRole('link', { name: '完整分析' })
  expect(link).toHaveAttribute('href', '/teacher/analysis?exam=e2')
  const select = screen.getByRole('combobox', { name: '选择考试' })
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['考试e2', '考试e1'])
  fireEvent.change(select, { target: { value: 'e1' } })
  expect(screen.getByRole('link', { name: '完整分析' })).toHaveAttribute('href', '/teacher/analysis?exam=e1')
  // 最早一场没有对比考试:不出现进退角标
  expect(screen.getByRole('button', { name: '李小二，第1排第2列' })).toBeInTheDocument()
})

it('shows the empty hint without exams', async () => {
  setup({ mode: '成绩', roster })
  expect(await screen.findByText('还没有考试成绩')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '去录入' })).toHaveAttribute('href', '/teacher/scores')
  expect(screen.queryByRole('combobox', { name: '选择考试' })).toBeNull()
  expect(screen.queryByText('前 20%')).toBeNull()
})

it('shows the empty hint when no exam has a score yet', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue({ exams: [exam('e1', '2026-09-20', null)] })
  setup({ mode: '成绩', roster })
  expect(await screen.findByText('还没有考试成绩')).toBeInTheDocument()
})
