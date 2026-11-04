import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import type { HistoryClass, HistoryExam, HistoryScores, HistoryStudent, HistoryYear } from '@/shared/types/admin'
import HistoryClassPage from './HistoryClassPage'
import HistoryPage from './HistoryPage'

vi.mock('@/shared/api/admin')

const y25: HistoryYear = { id: 'y25', name: '2025-2026 学年', start_date: '2025-09-01', end_date: '2026-07-15' }
const y24: HistoryYear = { id: 'y24', name: '2024-2025 学年', start_date: '2024-09-01', end_date: '2025-07-15' }

const cls = (over: Partial<HistoryClass>): HistoryClass => ({
  class_id: 'c1', class_name: '高一1班', grade_name: '高一', homeroom_name: '赵老师', students: 42, ...over,
})
const CLASSES_25: HistoryClass[] = [
  cls({ class_id: 'c1', class_name: '高一1班', grade_name: '高一', homeroom_name: '赵老师', students: 42 }),
  cls({ class_id: 'c2', class_name: '高一2班', grade_name: '高一', homeroom_name: null, students: 40 }),
  cls({ class_id: 'c3', class_name: '高二1班', grade_name: '高二', homeroom_name: '钱老师', students: 38 }),
]
const CLASSES_24: HistoryClass[] = [cls({ class_id: 'c9', class_name: '初三1班', grade_name: '初三', students: 35 })]

const STUDENTS: HistoryStudent[] = [
  { student_id: 's1', name: '张小三', student_no: '2501', status: 'active' },
  { student_id: 's2', name: '李小二', student_no: null, status: 'promoted' },
  { student_id: 's3', name: '王小一', student_no: '2503', status: 'graduated' },
  { student_id: 's4', name: '赵小四', student_no: '2504', status: 'transferred' },
  { student_id: 's5', name: '孙小五', student_no: '2505', status: 'removed' },
  { student_id: 's6', name: '周小六', student_no: '2506', status: 'mystery' },
]

const exam = (over: Partial<HistoryExam>): HistoryExam => ({
  id: 'e2', name: '期末考试', exam_type: '期末', date: '2026-06-30',
  subjects: [{ name: '语文', full: 150 }, { name: '数学', full: 150 }], ...over,
})
const EXAMS: HistoryExam[] = [exam({ id: 'e2' }), exam({ id: 'e1', name: '期中考试', exam_type: '期中', date: '2025-11-10' })]

const scores = (e: HistoryExam): HistoryScores => ({
  exam: e,
  students: [
    { student_id: 's1', name: '张小三', student_no: '2501', scores: { 语文: 120, 数学: 135 }, total: 255, class_rank: 1 },
    { student_id: 's2', name: '李小二', student_no: null, scores: { 语文: 110, 数学: null }, total: null, class_rank: null },
  ],
})

function setup(entry = '/admin/history') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/history" element={<HistoryPage />} />
          <Route path="/admin/history/classes/:id" element={<HistoryClassPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.historyYears).mockResolvedValue([y25, y24])
  vi.mocked(adminApi.historyClasses).mockImplementation(async (yid) => (yid === 'y25' ? CLASSES_25 : CLASSES_24))
  vi.mocked(adminApi.historyStudents).mockResolvedValue({ students: STUDENTS })
  vi.mocked(adminApi.historyExams).mockResolvedValue(EXAMS)
  vi.mocked(adminApi.historyScores).mockImplementation(async (eid) => scores(EXAMS.find((e) => e.id === eid) ?? EXAMS[0]))
})
afterEach(cleanup)

const FORBIDDEN = new ApiError(403, 'FORBIDDEN', '无权限')

describe('往年班级列表页', () => {
  it('没有往年数据时显示空状态', async () => {
    vi.mocked(adminApi.historyYears).mockResolvedValue([])
    setup()
    expect(await screen.findByText('还没有往年数据,完成第一次学年升级后会出现在这里')).toBeInTheDocument()
    expect(adminApi.historyClasses).not.toHaveBeenCalled()
  })

  it('默认选中最近的往年并按它请求班级', async () => {
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: '往年班级' })).toBeInTheDocument()
    const sel = await screen.findByRole('combobox', { name: '学年' })
    expect(sel).toHaveValue('y25')
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual([y25.name, y24.name])
    await waitFor(() => expect(adminApi.historyClasses).toHaveBeenCalledWith('y25'))
  })

  it('切换学年后以新学年 id 请求班级', async () => {
    setup()
    fireEvent.change(await screen.findByRole('combobox', { name: '学年' }), { target: { value: 'y24' } })
    await waitFor(() => expect(adminApi.historyClasses).toHaveBeenCalledWith('y24'))
    expect(await screen.findByText('初三1班')).toBeInTheDocument()
    expect(screen.queryByText('高一1班')).toBeNull()
  })

  it('班级按年级分组渲染,卡片链接带学年参数', async () => {
    setup()
    const g1 = await screen.findByRole('heading', { level: 2, name: '高一' })
    const g2 = screen.getByRole('heading', { level: 2, name: '高二' })
    expect(g1.compareDocumentPosition(g2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const c1 = screen.getByRole('link', { name: /高一1班/ })
    expect(c1).toHaveAttribute('href', '/admin/history/classes/c1?year=y25')
    expect(c1).toHaveTextContent('班主任 赵老师')
    expect(c1).toHaveTextContent('42 人')
    expect(screen.getByRole('link', { name: /高一2班/ })).toHaveTextContent('未设班主任')
    expect(screen.getByRole('link', { name: /高二1班/ })).toHaveAttribute('href', '/admin/history/classes/c3?year=y25')
  })

  it('年级组长看不到往年班时提示该学年没有可查看的班级', async () => {
    vi.mocked(adminApi.historyClasses).mockResolvedValue([])
    setup()
    expect(await screen.findByText('该学年没有可查看的班级')).toBeInTheDocument()
  })

  it('403 显示无权限状态', async () => {
    vi.mocked(adminApi.historyClasses).mockRejectedValue(FORBIDDEN)
    setup()
    expect(await screen.findByText('没有权限查看往年班级')).toBeInTheDocument()
  })

  it('年份列表 403 同样显示无权限状态', async () => {
    vi.mocked(adminApi.historyYears).mockRejectedValue(FORBIDDEN)
    setup()
    expect(await screen.findByText('没有权限查看往年班级')).toBeInTheDocument()
  })

  it('学年不存在(404)显示该学年不存在', async () => {
    vi.mocked(adminApi.historyClasses).mockRejectedValue(new ApiError(404, 'YEAR_NOT_FOUND', '学年不存在'))
    setup()
    expect(await screen.findByText('该学年不存在')).toBeInTheDocument()
  })

  it('请求失败显示错误并可重试', async () => {
    vi.mocked(adminApi.historyClasses).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '出错了'))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('高一1班')).toBeInTheDocument()
  })

  it('点班级进入单班页', async () => {
    setup()
    fireEvent.click(await screen.findByRole('link', { name: /高二1班/ }))
    expect(await screen.findByRole('heading', { level: 1, name: '2025-2026 学年 高二1班' })).toBeInTheDocument()
    expect(adminApi.historyStudents).toHaveBeenCalledWith('c3')
  })

  it('从较早学年的班返回时回到原来那个学年的列表', async () => {
    setup()
    fireEvent.change(await screen.findByRole('combobox', { name: '学年' }), { target: { value: 'y24' } })
    fireEvent.click(await screen.findByRole('link', { name: /初三1班/ }))
    expect(await screen.findByRole('heading', { level: 1, name: '2024-2025 学年 初三1班' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '← 往年班级' }))
    expect(await screen.findByRole('heading', { level: 1, name: '往年班级' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '学年' })).toHaveValue('y24')
    expect(await screen.findByRole('link', { name: /初三1班/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /高二1班/ })).toBeNull()
  })

  it('?year= 指向已不存在的学年时回到最近一个往年', async () => {
    setup('/admin/history?year=gone')
    expect(await screen.findByRole('link', { name: /高二1班/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '学年' })).toHaveValue('y25')
  })
})

describe('往年单班页', () => {
  it('标题显示学年名与班名,返回链接回列表', async () => {
    setup('/admin/history/classes/c1?year=y25')
    expect(await screen.findByRole('heading', { level: 1, name: '2025-2026 学年 高一1班' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← 往年班级' })).toHaveAttribute('href', '/admin/history?year=y25')
  })

  it('缺少 year 参数时标题退化为往年班级且不请求学年数据', async () => {
    setup('/admin/history/classes/c1')
    expect(await screen.findByRole('heading', { level: 1, name: '往年班级' })).toBeInTheDocument()
    expect(await screen.findByText('张小三')).toBeInTheDocument()
    expect(adminApi.historyClasses).not.toHaveBeenCalled()
  })

  it('year 查不到时标题退化为往年班级', async () => {
    setup('/admin/history/classes/c1?year=nope')
    await screen.findByText('张小三')
    expect(screen.getByRole('heading', { level: 1, name: '往年班级' })).toBeInTheDocument()
  })

  it('名单默认展示,状态映射为中文,缺学号显示破折号,未知状态原样', async () => {
    setup('/admin/history/classes/c1?year=y25')
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['学号', '姓名', '状态'])
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(name) })
    expect(row('张小三')).toHaveTextContent('2501')
    expect(row('张小三')).toHaveTextContent('在读')
    expect(row('李小二')).toHaveTextContent('—')
    expect(row('李小二')).toHaveTextContent('已升级')
    expect(row('王小一')).toHaveTextContent('已毕业')
    expect(row('赵小四')).toHaveTextContent('已转出')
    expect(row('孙小五')).toHaveTextContent('已移出')
    expect(row('周小六')).toHaveTextContent('mystery')
    expect(screen.getByRole('tab', { name: '名单' })).toHaveAttribute('aria-selected', 'true')
  })

  it('点学生行不会打开档案', async () => {
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByText('张小三'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点成绩页签才请求考试,默认选最近一场并请求其成绩', async () => {
    setup('/admin/history/classes/c1?year=y25')
    await screen.findByText('张小三')
    expect(adminApi.historyExams).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: '成绩' }))
    const sel = await screen.findByRole('combobox', { name: '考试' })
    expect(adminApi.historyExams).toHaveBeenCalledWith('c1')
    expect(sel).toHaveValue('e2')
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['期末考试(2026-06-30)', '期中考试(2025-11-10)'])
    await waitFor(() => expect(adminApi.historyScores).toHaveBeenCalledWith('e2'))
  })

  it('成绩表展示各科、总分与名次,空值显示破折号', async () => {
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('tab', { name: '成绩' }))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['学号', '姓名', '语文 /150', '数学 /150', '总分', '班级名次'])
    const r1 = within(table).getByRole('row', { name: /张小三/ })
    expect(within(r1).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2501', '张小三', '120', '135', '255', '1'])
    const r2 = within(table).getByRole('row', { name: /李小二/ })
    expect(within(r2).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', '李小二', '110', '—', '—', '—'])
    expect(table.parentElement).toHaveClass('overflow-x-auto')
  })

  it('切换考试重新请求成绩', async () => {
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('tab', { name: '成绩' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '考试' }), { target: { value: 'e1' } })
    await waitFor(() => expect(adminApi.historyScores).toHaveBeenLastCalledWith('e1'))
    expect(await screen.findByRole('combobox', { name: '考试' })).toHaveValue('e1')
  })

  it('这个班没有考试时显示空状态', async () => {
    vi.mocked(adminApi.historyExams).mockResolvedValue([])
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('tab', { name: '成绩' }))
    expect(await screen.findByText('这个班没有考试记录')).toBeInTheDocument()
    expect(adminApi.historyScores).not.toHaveBeenCalled()
  })

  it('403 显示无权限状态', async () => {
    vi.mocked(adminApi.historyStudents).mockRejectedValue(FORBIDDEN)
    setup('/admin/history/classes/c1?year=y25')
    expect(await screen.findByText('没有权限查看往年班级')).toBeInTheDocument()
  })

  it('成绩页签 403 同样显示无权限状态', async () => {
    vi.mocked(adminApi.historyExams).mockRejectedValue(FORBIDDEN)
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('tab', { name: '成绩' }))
    expect(await screen.findByText('没有权限查看往年班级')).toBeInTheDocument()
  })

  it('名单加载失败显示错误并可重试', async () => {
    vi.mocked(adminApi.historyStudents).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '出错了'))
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('张小三')).toBeInTheDocument()
  })

  it('成绩加载失败显示错误并可重试', async () => {
    vi.mocked(adminApi.historyScores).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '出错了'))
    setup('/admin/history/classes/c1?year=y25')
    fireEvent.click(await screen.findByRole('tab', { name: '成绩' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})

describe('往年班级只读', () => {
  const NO_WRITE = /编辑|删除|导出/
  function expectNoWrite() {
    expect(screen.queryByRole('button', { name: NO_WRITE })).toBeNull()
    expect(screen.queryByRole('link', { name: NO_WRITE })).toBeNull()
  }

  it('列表页没有编辑、删除、导出入口', async () => {
    setup()
    await screen.findByText('高一1班')
    expectNoWrite()
  })

  it('单班页的名单与成绩页签都没有编辑、删除、导出入口', async () => {
    setup('/admin/history/classes/c1?year=y25')
    await screen.findByText('张小三')
    expectNoWrite()
    fireEvent.click(screen.getByRole('tab', { name: '成绩' }))
    await screen.findByRole('table')
    expectNoWrite()
  })
})
