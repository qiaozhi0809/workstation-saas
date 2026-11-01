import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import type { AttendanceUpdated } from '@/shared/types/attendance'
import { ApiError } from '@/shared/api/client'
import * as csv from '@/shared/lib/csv'
import { defaultApiMocks, setup } from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

it('cycles status with absolute PUTs', async () => {
  let resolve!: (v: AttendanceUpdated) => void
  vi.mocked(attendanceApi.set).mockReturnValue(new Promise((r) => { resolve = r }))
  setup({ mode: '考勤' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  await waitFor(() => expect(attendanceApi.set).toHaveBeenCalledWith('c1', '2026-11-02', 'e1', { status: 'leave' }))
  expect(await screen.findByText('请假')).toBeInTheDocument()
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null,
    items: [{ enrollment_id: 'e1', status: 'leave', reason: null, marked_at: '2026-11-02T01:00:00Z' }] })
  await act(async () => { resolve({ enrollment_id: 'e1', status: 'leave', reason: null }) })
  await screen.findByText('请假')
  vi.mocked(attendanceApi.set).mockReturnValue(new Promise(() => {}))
  fireEvent.click(screen.getByRole('button', { name: '王小一' }))
  await waitFor(() => expect(attendanceApi.set).toHaveBeenLastCalledWith('c1', '2026-11-02', 'e1', { status: 'absent' }))
})

it('shows the chip optimistically and rolls back on error', async () => {
  let reject!: (e: Error) => void
  vi.mocked(attendanceApi.set).mockReturnValue(new Promise((_, rej) => { reject = rej }))
  setup({ mode: '考勤' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  expect(await screen.findByText('请假')).toBeInTheDocument()
  await act(async () => { reject(new ApiError(400, 'DATE_OUT_OF_RANGE', '只能记录本学年内、不晚于今天的考勤')) })
  expect(await screen.findByText('只能记录本学年内、不晚于今天的考勤')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('请假')).toBeNull())
})

it('confirms the whole class present', async () => {
  vi.mocked(attendanceApi.confirm).mockResolvedValue({ date: '2026-11-02', confirmed_at: '2026-11-02T01:30:00Z', items: [] })
  setup({ mode: '考勤' })
  fireEvent.click(await screen.findByRole('button', { name: '全部出勤' }))
  await waitFor(() => expect(attendanceApi.confirm).toHaveBeenCalledWith('c1', '2026-11-02', true))
  expect(await screen.findByText('已确认 09:30')).toBeInTheDocument()
})

it('confirms keeping the exceptions', async () => {
  setup({ mode: '考勤' })
  fireEvent.click(await screen.findByRole('button', { name: '确认考勤' }))
  await waitFor(() => expect(attendanceApi.confirm).toHaveBeenCalledWith('c1', '2026-11-02', false))
})

it('caps the date picker between the year start and today', async () => {
  setup({ mode: '考勤' })
  const input = await screen.findByLabelText('考勤日期')
  expect(input).toHaveAttribute('max', '2026-11-02')
  expect(input).toHaveAttribute('min', '2026-09-01')
})

it('picks another date, then returns to today', async () => {
  setup({ mode: '考勤' })
  fireEvent.change(await screen.findByLabelText('考勤日期'), { target: { value: '2026-10-30' } })
  await waitFor(() => expect(attendanceApi.day).toHaveBeenCalledWith('c1', '2026-10-30'))
  fireEvent.click(await screen.findByRole('button', { name: '回到今天' }))
  expect(await screen.findByLabelText('考勤日期')).toHaveValue('2026-11-02')
  expect(screen.queryByRole('button', { name: '回到今天' })).toBeNull()
})

it('shows the stats line', async () => {
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null, items: [
    { enrollment_id: 'e1', status: 'leave', reason: null, marked_at: '2026-11-02T01:00:00Z' },
    { enrollment_id: 'e2', status: 'late', reason: null, marked_at: '2026-11-02T01:00:00Z' },
  ] })
  setup({ mode: '考勤' })
  expect(await screen.findByText('实到 2/3')).toBeInTheDocument()
  expect(screen.getByText('请假 1')).toBeInTheDocument()
  expect(screen.getByText('缺勤 0')).toBeInTheDocument()
  expect(screen.getByText('迟到 1')).toBeInTheDocument()
})

it('overlays attendance in daily mode but not in seating mode', async () => {
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null, items: [
    { enrollment_id: 'e1', status: 'absent', reason: null, marked_at: '2026-11-02T01:00:00Z' },
  ] })
  const daily = setup()
  expect(await screen.findByText('缺勤')).toBeInTheDocument()
  daily.unmount()
  setup({ mode: '排座' })
  await screen.findAllByText('王小一')
  expect(screen.queryByText('缺勤')).toBeNull()
})

it('lets a subject teacher look but not mark', async () => {
  setup({ mode: '考勤', perms: ['attendance.read', 'review.read', 'review.write'] })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  expect(await screen.findByText('只有班主任和副班主任可以记考勤')).toBeInTheDocument()
  expect(attendanceApi.set).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '全部出勤' })).toBeNull()
})

it('exports the month as CSV', async () => {
  const spy = vi.spyOn(csv, 'downloadText').mockImplementation(() => {})
  vi.mocked(attendanceApi.month).mockResolvedValue({ month: '2026-11',
    items: [{ enrollment_id: 'e1', date: '2026-11-02', status: 'leave' }] })
  setup({ mode: '考勤' })
  fireEvent.click(await screen.findByRole('button', { name: '导出本月' }))
  await waitFor(() => expect(spy).toHaveBeenCalledWith('三年二班-考勤-2026-11.csv', expect.stringContaining('请假')))
})
