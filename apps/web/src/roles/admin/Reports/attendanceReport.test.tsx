import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { downloadBlob } from '@/shared/lib/download'
import type { AttendanceClassDetail, AttendanceReport } from '@/shared/types/admin'
import type { Meta } from '@/shared/types/school'
import { boardView } from '../Board/boardFixtures'
import AttendanceReportPage from './AttendanceReportPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    board: vi.fn(),
    attendanceReport: vi.fn(),
    attendanceClass: vi.fn(),
    exportAttendance: vi.fn(),
  },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))
vi.mock('@/shared/lib/download', () => ({ downloadBlob: vi.fn() }))

const META: Meta = { version: '1.0.0', school_name: '示例小学', school_tz: 'Asia/Shanghai' }

const report = (month: string): AttendanceReport => ({
  month,
  scope_label: '全校',
  classes: [
    {
      class_id: 'c1',
      class_name: '三年一班',
      grade_name: '三年级',
      days: 20,
      expected: 800,
      present: 780,
      leave: 12,
      absent: 8,
      late: 5,
      rate: 0.975,
    },
    {
      class_id: 'c2',
      class_name: '三年二班',
      grade_name: '三年级',
      days: 0,
      expected: 0,
      present: 0,
      leave: 0,
      absent: 0,
      late: 0,
      rate: null,
    },
  ],
  total: { days: 20, expected: 800, present: 780, leave: 12, absent: 8, late: 5, rate: 0.975 },
})

const detail: AttendanceClassDetail = {
  month: '2026-10',
  class_id: 'c1',
  class_name: '三年一班',
  days: 20,
  students: [
    { student_id: 's1', name: '王小一', student_no: '2026001', leave: 0, absent: 3, late: 1 },
    { student_id: 's2', name: '李小二', student_no: null, leave: 2, absent: 0, late: 0 },
  ],
}

function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AttendanceReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 2026-10-31 16:30 UTC:学校(上海)已进入 11 月,UTC−12 … UTC+7 的浏览器还在 10 月
  vi.setSystemTime(new Date('2026-10-31T16:30:00Z'))
  vi.mocked(schoolApi.meta).mockResolvedValue(META)
  vi.mocked(adminApi.board).mockResolvedValue(boardView())
  vi.mocked(adminApi.attendanceReport).mockImplementation(async (m) => report(m))
  vi.mocked(adminApi.attendanceClass).mockResolvedValue(detail)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('月度考勤报告', () => {
  it('默认学校时区里的本月(L43),左右箭头与年级筛选改变请求参数', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: '月度考勤报告' })).toBeInTheDocument()
    expect(screen.getByText('只统计班主任确认过考勤的日子;迟到算出勤')).toBeInTheDocument()
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-11', null))
    expect(screen.getByText('2026年11月')).toBeInTheDocument()
    // 只请求过一次:不是先按浏览器月份查一遍再改
    expect(adminApi.attendanceReport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '下一月' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '上一月' }))
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-10', null))
    expect(screen.getByText('2026年10月')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一月' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '下一月' }))
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-11', null))
    expect(screen.getByRole('button', { name: '下一月' })).toBeDisabled()

    const select = await screen.findByRole('combobox', { name: '年级' })
    await screen.findByRole('option', { name: '四年级' })
    fireEvent.change(select, { target: { value: 'g4' } })
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-11', 'g4'))
  })

  it('出勤率保留一位小数,null 显示破折号,有合计行', async () => {
    setup()
    const row1 = (await screen.findByText('三年一班')).closest('tr') as HTMLElement
    expect(within(row1).getByText('97.5%')).toBeInTheDocument()
    expect(within(row1).getByText('780')).toBeInTheDocument()
    const row2 = screen.getByText('三年二班').closest('tr') as HTMLElement
    expect(within(row2).getByText('—')).toBeInTheDocument()
    const total = screen.getByText('合计').closest('tr') as HTMLElement
    expect(within(total).getByText('97.5%')).toBeInTheDocument()
    expect(within(total).getByText('800')).toBeInTheDocument()
  })

  it('点班级才请求并展开学生明细,再点收起', async () => {
    setup()
    await screen.findByText('三年一班')
    expect(adminApi.attendanceClass).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /三年一班/ }))
    expect(await screen.findByText('王小一')).toBeInTheDocument()
    expect(screen.getByText('李小二')).toBeInTheDocument()
    expect(adminApi.attendanceClass).toHaveBeenCalledWith('2026-11', 'c1')
    fireEvent.click(screen.getByRole('button', { name: /三年一班/ }))
    expect(screen.queryByText('王小一')).toBeNull()
  })

  it('导出 CSV 走公共的 downloadBlob,文件名 考勤报告-月份.csv(L43)', async () => {
    const blob = new Blob(['x'], { type: 'text/csv' })
    vi.mocked(adminApi.exportAttendance).mockResolvedValue(blob)
    setup()
    await screen.findByText('三年一班')
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(adminApi.exportAttendance).toHaveBeenCalledWith('2026-11', null)
    expect(downloadBlob).toHaveBeenCalledWith(blob, '考勤报告-2026-11.csv')
    // 页面自己不再造 <a download>
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('年级列表加载失败时提示并可重试,而不是静默只剩"全部年级"(L59)', async () => {
    vi.mocked(adminApi.board).mockRejectedValueOnce(new Error('boom'))
    setup()
    await screen.findByText('三年一班')
    expect(await screen.findByRole('alert')).toHaveTextContent('年级列表加载失败')
    expect(screen.queryByRole('option', { name: '四年级' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试加载年级' }))
    expect(await screen.findByRole('option', { name: '四年级' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('班名列不折行,窄屏时表格容器横向滚动(L58)', async () => {
    setup()
    const cell = (await screen.findByText('三年一班')).closest('td') as HTMLElement
    expect(cell).toHaveClass('whitespace-nowrap')
    expect(cell.closest('table')?.parentElement).toHaveClass('overflow-x-auto')
  })

  it('403 时显示没有权限而不是可重试的通用错误(L41)', async () => {
    vi.mocked(adminApi.attendanceReport).mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'forbidden'),
    )
    setup()
    expect(await screen.findByText('没有权限查看考勤报告')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    expect(screen.queryByText('加载失败')).toBeNull()
  })

  it('打印按钮调用 window.print', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    setup()
    await screen.findByText('三年一班')
    fireEvent.click(screen.getByRole('button', { name: '打印' }))
    expect(print).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
