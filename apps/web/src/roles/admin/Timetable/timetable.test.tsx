import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { timetableApi } from '@/shared/api/timetable'
import { toast } from '@/shared/components/Toast'
import type { ClassAdmin } from '@/shared/types/admin'
import type { ClassTimetable, Period } from '@/shared/types/timetable'
import TimetablePage from './TimetablePage'

vi.mock('@/shared/api/admin', () => ({ adminApi: { classes: vi.fn(), class: vi.fn() } }))
vi.mock('@/shared/api/timetable', () => ({
  timetableApi: {
    periods: vi.fn(),
    savePeriods: vi.fn(),
    classTimetable: vi.fn(),
    saveClassTimetable: vi.fn(),
    importCsv: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const PERIODS: Period[] = [
  { no: 1, starts_at: '08:00', ends_at: '08:40' },
  { no: 2, starts_at: '08:50', ends_at: '09:30' },
]
const cls = (over: Partial<ClassAdmin> = {}): ClassAdmin => ({
  id: 'c1',
  name: '三年二班',
  grade_id: 'g3',
  grade_name: '三年级',
  room: '301',
  student_count: 40,
  homeroom: { assignment_id: 'a1', user_id: 'u1', teacher_id: 't1', display_name: '李老师' },
  assistants: [],
  subjects: [
    {
      subject: '语文',
      teachers: [{ assignment_id: 'a2', user_id: 'u2', teacher_id: 't2', display_name: '王老师' }],
    },
    {
      subject: '数学',
      teachers: [
        { assignment_id: 'a3', user_id: 'u3', teacher_id: 't3', display_name: '赵老师' },
        { assignment_id: 'a4', user_id: 'u4', teacher_id: 't4', display_name: '钱老师' },
      ],
    },
  ],
  desk_size: 2,
  seat_layout: 'auto',
  seat_rows: 6,
  seat_cols: 4,
  podium_left: 0,
  podium_right: 0,
  ...over,
})
const OTHER = cls({ id: 'c2', name: '四年一班', grade_id: 'g4', grade_name: '四年级' })
const TT: ClassTimetable = {
  class_id: 'c1',
  class_name: '三年二班',
  cells: [{ weekday: 2, period_no: 1, subject: '数学', teacher: { id: 't3', name: '赵老师' } }],
}

let client: QueryClient
const renderPage = () =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/timetable']}>
        <TimetablePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(timetableApi.periods).mockResolvedValue(PERIODS)
  vi.mocked(adminApi.classes).mockResolvedValue([cls(), OTHER])
  vi.mocked(adminApi.class).mockResolvedValue(cls())
  vi.mocked(timetableApi.classTimetable).mockResolvedValue(TT)
})
afterEach(cleanup)

const editor = () => screen.getByTestId('periods-editor')

it('rejects overlapping periods', async () => {
  renderPage()
  await screen.findByTestId('periods-editor')
  expect(screen.getByLabelText('第 2 节开始时间')).toHaveValue('08:50')
  fireEvent.change(screen.getByLabelText('第 2 节开始时间'), { target: { value: '08:30' } })
  fireEvent.click(screen.getByRole('button', { name: '保存作息' }))
  expect(await within(editor()).findByRole('alert')).toHaveTextContent('第 1 节与第 2 节时间重叠')
  expect(timetableApi.savePeriods).not.toHaveBeenCalled()
  // 结束早于开始也不放行
  fireEvent.change(screen.getByLabelText('第 2 节开始时间'), { target: { value: '09:40' } })
  fireEvent.click(screen.getByRole('button', { name: '保存作息' }))
  expect(within(editor()).getByRole('alert')).toHaveTextContent('第 2 节开始时间必须早于结束时间')
  expect(timetableApi.savePeriods).not.toHaveBeenCalled()
})

it('adds a period, saves the sorted list and shows PERIOD_IN_USE from the backend', async () => {
  vi.mocked(timetableApi.savePeriods).mockResolvedValueOnce([
    ...PERIODS,
    { no: 3, starts_at: '09:40', ends_at: '10:20' },
  ])
  renderPage()
  await screen.findByTestId('periods-editor')
  fireEvent.click(screen.getByRole('button', { name: '添加节次' }))
  // 新节次默认接在上一节之后 10 分钟,时长 40 分钟
  expect(screen.getByLabelText('第 3 节开始时间')).toHaveValue('09:40')
  expect(screen.getByLabelText('第 3 节结束时间')).toHaveValue('10:20')
  fireEvent.click(screen.getByRole('button', { name: '保存作息' }))
  await waitFor(() =>
    expect(timetableApi.savePeriods).toHaveBeenCalledWith([
      { no: 1, starts_at: '08:00', ends_at: '08:40' },
      { no: 2, starts_at: '08:50', ends_at: '09:30' },
      { no: 3, starts_at: '09:40', ends_at: '10:20' },
    ]),
  )
  expect(toast).toHaveBeenCalledWith('已保存作息时间')
  // 课表格子跟着多出第 3 节
  expect(await screen.findByTestId('timetable-cell-1-3')).toBeInTheDocument()

  vi.mocked(timetableApi.savePeriods).mockRejectedValueOnce(
    new ApiError(409, 'PERIOD_IN_USE', '节次已被课表使用,不能删除。涉及班级:三年二班', {
      classes: ['三年二班'],
      periods: [1],
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '删除第 1 节' }))
  fireEvent.click(screen.getByRole('button', { name: '保存作息' }))
  expect(await within(editor()).findByRole('alert')).toHaveTextContent(
    '节次已被课表使用,不能删除。涉及班级:三年二班',
  )
})

// L215 ①:409 PERIOD_IN_USE 要把 details 里被占用的节次与班级列出来,并给"放弃修改"回到已保存的作息
it('period in use lists classes and offers discard', async () => {
  vi.mocked(timetableApi.savePeriods).mockRejectedValueOnce(
    new ApiError(409, 'PERIOD_IN_USE', '节次已被课表使用,不能删除。涉及班级:三年二班、四年一班', {
      classes: ['三年二班', '四年一班'],
      periods: [1, 2],
    }),
  )
  renderPage()
  await screen.findByTestId('periods-editor')
  fireEvent.click(screen.getByRole('button', { name: '删除第 1 节' }))
  expect(screen.queryByLabelText('第 1 节开始时间')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存作息' }))
  const alert = await within(editor()).findByRole('alert')
  expect(alert).toHaveTextContent('节次已被课表使用,不能删除。涉及班级:三年二班、四年一班')
  expect(alert).toHaveTextContent('第 1 节、第 2 节')
  expect(alert).toHaveTextContent('三年二班、四年一班')
  fireEvent.click(within(editor()).getByRole('button', { name: '放弃修改' }))
  // 回到已保存的作息:第 1 节又在了,提示消失,没有改动时保存按钮禁用
  expect(screen.getByLabelText('第 1 节开始时间')).toHaveValue('08:00')
  expect(within(editor()).queryByRole('alert')).toBeNull()
  expect(within(editor()).queryByRole('button', { name: '放弃修改' })).toBeNull()
  expect(screen.getByRole('button', { name: '保存作息' })).toBeDisabled()
  expect(timetableApi.savePeriods).toHaveBeenCalledTimes(1)
})

it('edits a cell with auto teacher', async () => {
  vi.mocked(timetableApi.saveClassTimetable).mockResolvedValue({
    ...TT,
    cells: [
      ...TT.cells,
      { weekday: 1, period_no: 1, subject: '语文', teacher: { id: 't2', name: '王老师' } },
    ],
  })
  renderPage()
  // 默认选中第一个班,格子里已有周二第 1 节的数学
  await screen.findByRole('option', { name: '四年一班' })
  expect(screen.getByLabelText('班级')).toHaveValue('c1')
  const existing = await screen.findByTestId('timetable-cell-2-1')
  expect(existing).toHaveTextContent('数学')
  expect(existing).toHaveTextContent('赵老师')
  // 周一到周五;没有周末课时就不显示周六日
  expect(screen.getByRole('columnheader', { name: '周五' })).toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: '周六' })).toBeNull()

  fireEvent.click(screen.getByTestId('timetable-cell-1-1'))
  const dlg = await screen.findByRole('dialog', { name: '周一 第 1 节' })
  const subjects = within(dlg)
    .getAllByRole('option')
    .map((o) => o.textContent)
  expect(subjects).toEqual(expect.arrayContaining(['语文', '数学']))
  fireEvent.change(within(dlg).getByLabelText('科目'), { target: { value: '语文' } })
  expect(within(dlg).getByLabelText('老师')).toHaveValue('')
  expect(within(dlg).getByRole('option', { name: '自动匹配' })).toBeInTheDocument()
  expect(dlg).toHaveTextContent('在任老师:王老师')
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(timetableApi.saveClassTimetable).toHaveBeenCalledWith('c1', [
      { weekday: 2, period_no: 1, subject: '数学', teacher_id: 't3' },
      { weekday: 1, period_no: 1, subject: '语文', teacher_id: null },
    ]),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const cell = screen.getByTestId('timetable-cell-1-1')
  expect(cell).toHaveTextContent('语文')
  expect(cell).toHaveTextContent('王老师')
  expect(toast).toHaveBeenCalledWith('已保存课表')
})

it('offers teachers already seen for that subject, warns about ambiguous auto match and clears a cell', async () => {
  vi.mocked(timetableApi.saveClassTimetable).mockResolvedValue({ ...TT, cells: [] })
  renderPage()
  fireEvent.click(await screen.findByTestId('timetable-cell-2-1'))
  const dlg = await screen.findByRole('dialog', { name: '周二 第 1 节' })
  expect(within(dlg).getByLabelText('科目')).toHaveValue('数学')
  // 课表里已出现过的老师可选;当前格子的老师已选中
  expect(within(dlg).getByLabelText('老师')).toHaveValue('t3')
  expect(within(dlg).getByRole('option', { name: '赵老师' })).toBeInTheDocument()
  expect(dlg).toHaveTextContent('在任老师:赵老师、钱老师(多位时自动匹配会留空)')
  fireEvent.click(within(dlg).getByRole('button', { name: '清空' }))
  await waitFor(() => expect(timetableApi.saveClassTimetable).toHaveBeenCalledWith('c1', []))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByTestId('timetable-cell-2-1')).not.toHaveTextContent('数学')
})

// L209:在任老师按组织架构给的 teacher_id 直接进候选,排在前面;课表里出现过、已不在任的同科老师排在后面
it('cell candidates prefer assigned teacher by teacher_id', async () => {
  const withLegacy: ClassTimetable = {
    ...TT,
    cells: [
      ...TT.cells,
      { weekday: 3, period_no: 2, subject: '数学', teacher: { id: 't9', name: '孙老师' } },
    ],
  }
  vi.mocked(timetableApi.classTimetable).mockResolvedValue(withLegacy)
  vi.mocked(timetableApi.saveClassTimetable).mockResolvedValue(withLegacy)
  renderPage()
  fireEvent.click(await screen.findByTestId('timetable-cell-1-1'))
  const dlg = await screen.findByRole('dialog', { name: '周一 第 1 节' })
  const candidates = () =>
    within(within(dlg).getByLabelText('老师'))
      .getAllByRole('option')
      .map((o) => [o.getAttribute('value'), o.textContent])
  // 语文:课表里从没出现过,但组织架构里有在任的王老师(t2)
  fireEvent.change(within(dlg).getByLabelText('科目'), { target: { value: '语文' } })
  await waitFor(() =>
    expect(candidates()).toEqual([
      ['', '自动匹配'],
      ['t2', '王老师'],
    ]),
  )
  fireEvent.change(within(dlg).getByLabelText('老师'), { target: { value: 't2' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(timetableApi.saveClassTimetable).toHaveBeenCalledWith(
      'c1',
      expect.arrayContaining([{ weekday: 1, period_no: 1, subject: '语文', teacher_id: 't2' }]),
    ),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // 数学:在任的赵老师(t3)、钱老师(t4)在前,课表里出现过但已不在任的孙老师(t9)在后,t3 不重复
  fireEvent.click(screen.getByTestId('timetable-cell-2-1'))
  const math = await screen.findByRole('dialog', { name: '周二 第 1 节' })
  expect(
    within(within(math).getByLabelText('老师'))
      .getAllByRole('option')
      .map((o) => [o.getAttribute('value'), o.textContent]),
  ).toEqual([
    ['', '自动匹配'],
    ['t3', '赵老师'],
    ['t4', '钱老师'],
    ['t9', '孙老师'],
  ])
})

it('does not guess about staff while class info is loading or failed', async () => {
  vi.mocked(adminApi.class).mockRejectedValue(new ApiError(500, 'X', '班级信息挂了'))
  renderPage()
  fireEvent.click(await screen.findByTestId('timetable-cell-2-1'))
  const dlg = await screen.findByRole('dialog', { name: '周二 第 1 节' })
  await waitFor(() => expect(adminApi.class).toHaveBeenCalled())
  expect(await within(dlg).findByText(/班级信息加载失败/)).toBeInTheDocument()
  expect(dlg).not.toHaveTextContent('还没有本班')
  expect(dlg).not.toHaveTextContent('在任老师:')
  // 课表里已有的科目与老师仍可选
  expect(within(dlg).getByRole('option', { name: '数学' })).toBeInTheDocument()
  expect(within(dlg).getByRole('option', { name: '赵老师' })).toBeInTheDocument()
})

it('shows the backend message when saving a cell fails and keeps the dialog open', async () => {
  vi.mocked(timetableApi.saveClassTimetable).mockRejectedValue(
    new ApiError(400, 'BAD_REQUEST', '「语文」不是本班科目'),
  )
  renderPage()
  fireEvent.click(await screen.findByTestId('timetable-cell-1-2'))
  const dlg = await screen.findByRole('dialog', { name: '周一 第 2 节' })
  fireEvent.change(within(dlg).getByLabelText('科目'), { target: { value: '语文' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('「语文」不是本班科目')
  expect(screen.getByRole('dialog', { name: '周一 第 2 节' })).toBeInTheDocument()
})

it('shows weekend columns when the class has weekend lessons and switches class', async () => {
  vi.mocked(timetableApi.classTimetable).mockImplementation(async (id) =>
    id === 'c2'
      ? {
          class_id: 'c2',
          class_name: '四年一班',
          cells: [{ weekday: 6, period_no: 1, subject: '语文', teacher: null }],
        }
      : TT,
  )
  renderPage()
  await screen.findByTestId('timetable-cell-2-1')
  fireEvent.change(screen.getByLabelText('班级'), { target: { value: 'c2' } })
  await waitFor(() => expect(timetableApi.classTimetable).toHaveBeenCalledWith('c2'))
  expect(await screen.findByRole('columnheader', { name: '周六' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: '周日' })).toBeInTheDocument()
  const sat = screen.getByTestId('timetable-cell-6-1')
  expect(sat).toHaveTextContent('语文')
  expect(sat).toHaveTextContent('未指定老师')
  // 格子容器自己横向滚动,页面不溢出
  expect(screen.getByTestId('timetable-grid')).toHaveClass('overflow-x-auto')
})

it('import shows row errors', async () => {
  vi.mocked(timetableApi.importCsv).mockResolvedValue({
    ok: false,
    written: 0,
    errors: [
      { line: 2, message: '班级不存在:三年九班' },
      { line: 5, message: '第 9 节尚未在作息时间中设置' },
    ],
  })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '导入 CSV' }))
  const dlg = await screen.findByTestId('timetable-import-dialog')
  expect(within(dlg).getByRole('button', { name: '导入' })).toBeDisabled()
  const file = new File(['班级,星期,节次,科目,工号\n三年九班,周一,1,语文,\n'], '课表.csv', {
    type: 'text/csv',
  })
  fireEvent.change(within(dlg).getByLabelText('选择 CSV 文件'), { target: { files: [file] } })
  expect(dlg).toHaveTextContent('课表.csv')
  fireEvent.click(within(dlg).getByRole('button', { name: '导入' }))
  await waitFor(() => expect(timetableApi.importCsv).toHaveBeenCalledWith(file))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent(
    '有 2 行有问题,这次没有写入任何数据',
  )
  const rows = within(dlg).getAllByRole('row').slice(1)
  expect(rows.map((r) => r.textContent)).toEqual([
    '2班级不存在:三年九班',
    '5第 9 节尚未在作息时间中设置',
  ])
  expect(screen.getByTestId('timetable-import-dialog')).toBeInTheDocument()
  expect(toast).not.toHaveBeenCalled()
})

it('closes after a successful import and refreshes timetables', async () => {
  vi.mocked(timetableApi.importCsv).mockResolvedValue({ ok: true, written: 30, errors: [] })
  renderPage()
  await screen.findByTestId('timetable-cell-2-1')
  const before = vi.mocked(timetableApi.classTimetable).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '导入 CSV' }))
  const dlg = await screen.findByTestId('timetable-import-dialog')
  const file = new File(['x'], '课表.csv', { type: 'text/csv' })
  fireEvent.change(within(dlg).getByLabelText('选择 CSV 文件'), { target: { files: [file] } })
  fireEvent.click(within(dlg).getByRole('button', { name: '导入' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已导入 30 节课'))
  await waitFor(() => expect(screen.queryByTestId('timetable-import-dialog')).toBeNull())
  await waitFor(() =>
    expect(vi.mocked(timetableApi.classTimetable).mock.calls.length).toBeGreaterThan(before),
  )
})

it('shows a header error from the backend inside the import dialog', async () => {
  vi.mocked(timetableApi.importCsv).mockRejectedValue(
    new ApiError(400, 'BAD_REQUEST', '表头应为:班级,星期,节次,科目,工号'),
  )
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '导入 CSV' }))
  const dlg = await screen.findByTestId('timetable-import-dialog')
  fireEvent.change(within(dlg).getByLabelText('选择 CSV 文件'), {
    target: { files: [new File(['x'], 'bad.csv', { type: 'text/csv' })] },
  })
  fireEvent.click(within(dlg).getByRole('button', { name: '导入' }))
  expect(await within(dlg).findByRole('alert')).toHaveTextContent(
    '表头应为:班级,星期,节次,科目,工号',
  )
})

it('asks for periods first when none are set', async () => {
  vi.mocked(timetableApi.periods).mockResolvedValue([])
  renderPage()
  expect(await screen.findByText('先在上面设置作息时间,再排课表')).toBeInTheDocument()
  expect(screen.queryByTestId('timetable-grid')).toBeNull()
})
