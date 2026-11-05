import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import type { AttendanceClassDetail, AttendanceReport } from '@/shared/types/admin'
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
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0, 0))
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
  it('默认本月,左右箭头与年级筛选改变请求参数', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: '月度考勤报告' })).toBeInTheDocument()
    expect(screen.getByText('只统计班主任确认过考勤的日子;迟到算出勤')).toBeInTheDocument()
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-10', null))
    expect(screen.getByText('2026年10月')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一月' }))
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-09', null))
    expect(screen.getByText('2026年9月')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一月' }))
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-10', null))
    expect(screen.getByRole('button', { name: '下一月' })).toBeDisabled()

    const select = await screen.findByRole('combobox', { name: '年级' })
    await screen.findByRole('option', { name: '四年级' })
    fireEvent.change(select, { target: { value: 'g4' } })
    await waitFor(() => expect(adminApi.attendanceReport).toHaveBeenLastCalledWith('2026-10', 'g4'))
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
    expect(adminApi.attendanceClass).toHaveBeenCalledWith('2026-10', 'c1')
    fireEvent.click(screen.getByRole('button', { name: /三年一班/ }))
    expect(screen.queryByText('王小一')).toBeNull()
  })

  it('导出 CSV 以 考勤报告-月份.csv 触发下载并释放对象地址', async () => {
    const blob = new Blob(['x'], { type: 'text/csv' })
    vi.mocked(adminApi.exportAttendance).mockResolvedValue(blob)
    const create = vi.fn(() => 'blob:test-1')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href })
    })
    setup()
    await screen.findByText('三年一班')
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(adminApi.exportAttendance).toHaveBeenCalledWith('2026-10', null)
    expect(create).toHaveBeenCalledWith(blob)
    expect(clicked[0]).toEqual({ download: '考勤报告-2026-10.csv', href: 'blob:test-1' })
    expect(revoke).toHaveBeenCalledWith('blob:test-1')
    expect(document.querySelector('a[download]')).toBeNull()
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
