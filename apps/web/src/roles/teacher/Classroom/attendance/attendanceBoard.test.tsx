import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
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

const stub = (w: number, h: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h })
}
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
})

const day = (date: string) => ({
  date,
  confirmed_at: null,
  items: [
    {
      enrollment_id: 'e1',
      status: 'leave' as const,
      reason: null,
      marked_at: '2026-11-02T01:00:00Z',
    },
    {
      enrollment_id: 'e2',
      status: 'late' as const,
      reason: null,
      marked_at: '2026-11-02T01:00:00Z',
    },
  ],
})

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
  vi.mocked(attendanceApi.day).mockImplementation(async (_c, date) => day(date))
})

const board = () => document.querySelector('[data-wing-board]') as SVGGElement | null

it('draws today’s attendance on the left wing in every mode, summary numbers only', async () => {
  stub(1600, 900)
  setup()
  await waitFor(() => expect(board()).not.toBeNull())
  const b = within(board() as unknown as HTMLElement)
  expect(b.getByText('今日出勤')).toBeInTheDocument()
  expect(b.getByText('/3')).toBeInTheDocument()
  expect(board()!.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(board()!.textContent).not.toMatch(/王小一|李小二|张小三/)
})

it('shows no board until the attendance has loaded', async () => {
  stub(1600, 900)
  vi.mocked(attendanceApi.day).mockReturnValue(new Promise(() => {}))
  setup()
  await screen.findByRole('toolbar', { name: '教室工具' })
  expect(board()).toBeNull()
})

it('moves the numbers off the dock when the board is in view, keeping a screen-reader copy', async () => {
  stub(1600, 900)
  setup({ mode: '考勤' })
  await waitFor(() => expect(board()).not.toBeNull())
  const dock = screen.getByRole('toolbar', { name: '教室工具' })
  await waitFor(() => expect(within(dock).getByText('实到 2/3')).toHaveClass('sr-only'))
  expect(within(dock).getByText('请假 1')).toHaveClass('sr-only')
  expect(within(dock).getByText('缺勤 0')).toHaveClass('sr-only')
  expect(within(dock).getByText('迟到 1')).toHaveClass('sr-only')
  expect(within(dock).queryByText('2/3')).toBeNull()
})

it('falls back to a compact badge on the dock when the board cannot be seen', async () => {
  // jsdom 里舞台尺寸是 0,适应视图下看不到牌子
  setup({ mode: '考勤' })
  const badge = await screen.findByText('2/3')
  expect(badge).toHaveAttribute('title', '实到 2/3 · 请假 1 · 缺勤 0 · 迟到 1')
  expect(screen.getByText('实到 2/3')).toHaveClass('sr-only')
})

it('titles the board with the viewed date when it is not today', async () => {
  stub(1600, 900)
  setup({ mode: '考勤' })
  await waitFor(() => expect(board()).not.toBeNull())
  expect(within(board() as unknown as HTMLElement).getByText('今日出勤')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /^考勤日期/ }))
  fireEvent.change(await screen.findByLabelText('考勤日期'), { target: { value: '2026-10-30' } })
  await waitFor(() =>
    expect(within(board() as unknown as HTMLElement).getByText('10/30 出勤')).toBeInTheDocument(),
  )
})
