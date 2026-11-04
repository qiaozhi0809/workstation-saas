import { screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { parentApi } from '@/shared/api/parent'
import { child, mockWidth, renderParent, setParentUser, today } from '../testkit'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), today: vi.fn(), profile: vi.fn(), saveContacts: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue([child()])
  vi.mocked(parentApi.today).mockResolvedValue(today())
})

const open = () => renderParent('/parent/today?child=s1')

it.each([
  [{ status: 'present', reason: null }, true, '出勤'],
  [{ status: 'leave', reason: '感冒' }, true, '请假:感冒'],
  [{ status: 'absent', reason: null }, true, '缺勤'],
  [{ status: 'late', reason: null }, true, '迟到'],
  [null, false, '老师还没点名'],
] as const)('shows attendance %j as %s', async (attendance, confirmed, text) => {
  vi.mocked(parentApi.today).mockResolvedValue(today({ attendance, attendance_confirmed: confirmed }))
  open()
  const card = await screen.findByRole('region', { name: '今日出勤' })
  expect(within(card).getByText(text)).toBeInTheDocument()
})

it('shows a leave without reason as plain 请假', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({ attendance: { status: 'leave', reason: null } }))
  open()
  const card = await screen.findByRole('region', { name: '今日出勤' })
  expect(within(card).getByText('请假')).toBeInTheDocument()
})

it('titles the page with the date and shows week points', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({ week_points: 7 }))
  open()
  expect(await screen.findByRole('heading', { name: /11月4日/ })).toBeInTheDocument()
  expect(screen.getByText('本周积分')).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
})

it('lists today reviews with signs and says so when there are none', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({
    reviews: [
      { id: 'r1', reason_text: '积极发言', score_delta: 2, subject: '数学', given_at: '2026-11-04T01:00:00Z', given_by_name: '李老师' },
      { id: 'r2', reason_text: '迟交作业', score_delta: -1, subject: null, given_at: '2026-11-04T02:00:00Z', given_by_name: null },
    ],
  }))
  const { unmount } = open()
  const list = await screen.findByRole('region', { name: '今日点评' })
  expect(within(list).getByText('+2')).toHaveClass('text-success')
  expect(within(list).getByText('-1')).toHaveClass('text-destructive')
  expect(within(list).getByText('积极发言')).toBeInTheDocument()
  unmount()
  vi.mocked(parentApi.today).mockResolvedValue(today({ reviews: [] }))
  open()
  expect(await screen.findByText('今天还没有点评')).toBeInTheDocument()
})

it('draws the mini classroom with only the own child named', async () => {
  const { container } = open()
  const region = await screen.findByRole('region', { name: '班级座位' })
  expect(await within(region).findByRole('img', { name: '王小一的座位，第1排第2座' })).toBeInTheDocument()
  expect(within(region).getAllByRole('img', { name: /的座位/ })).toHaveLength(1)
  // 三个座位有人,只有自己孩子的座位带姓名,另两个匿名:页面上孩子姓名只出现在这一处
  expect(within(region).getAllByText('王小一')).toHaveLength(1)
  expect(container.querySelectorAll('[data-seat]').length).toBeGreaterThanOrEqual(3)
})

it('does not draw the map when the child has no seat of their own', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({
    seat_map: { rows: 2, cols: 2, desk_size: 2, podium_left: 0, podium_right: 0, occupied: [{ row: 1, col: 1 }], mine: null },
  }))
  open()
  expect(await screen.findByText('老师还没排座位')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /的座位/ })).toBeNull()
})

it('tolerates null lists and numbers from the backend', async () => {
  vi.mocked(parentApi.today).mockResolvedValue({
    ...today(), reviews: null, week_points: null,
    class_info: { class_name: '三年二班', homeroom_name: null, teachers: null },
    seat_map: { rows: 2, cols: 2, desk_size: 2, podium_left: 0, podium_right: 0, occupied: null, mine: null },
  } as never)
  open()
  expect(await screen.findByText('今天还没有点评')).toBeInTheDocument()
  expect(screen.getByText('老师还没排座位')).toBeInTheDocument()
  expect(screen.getByText('暂无')).toBeInTheDocument()
})

it('shows a zero review in a neutral colour without a plus sign', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({
    reviews: [{ id: 'r0', reason_text: '提醒一下', score_delta: 0, subject: null, given_at: '2026-11-04T01:00:00Z', given_by_name: null }],
  }))
  open()
  const list = await screen.findByRole('region', { name: '今日点评' })
  const zero = within(list).getByText('0', { selector: 'span.min-w-10' })
  expect(zero).toHaveClass('text-muted-foreground')
  expect(zero).not.toHaveClass('text-success')
})

it('falls back to a dateless note when the read-only dates are null', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([child({ status: 'readonly', left_on: null, archive_on: null })])
  vi.mocked(parentApi.today).mockResolvedValue(today({ status: 'readonly', seat_map: null, class_info: null, enrollment_id: null }))
  open()
  expect(await screen.findByText('孩子已毕业 / 离校,可以继续查看在校期间的成长与成绩')).toBeInTheDocument()
})

it('shows the note when only the child list says read-only', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([child({ status: 'readonly', left_on: '2026-07-10', archive_on: '2027-07-10' })])
  open()
  expect(await screen.findByText(/孩子已于 2026-07-10 毕业/)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '今日出勤' })).toBeNull()
})

it('says the teacher has not arranged seats when there is no seat map', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({ seat_map: null }))
  open()
  expect(await screen.findByText('老师还没排座位')).toBeInTheDocument()
})

it('says so when the seat map is empty', async () => {
  vi.mocked(parentApi.today).mockResolvedValue(today({
    seat_map: { rows: 2, cols: 2, desk_size: 2, podium_left: 0, podium_right: 0, occupied: [], mine: null },
  }))
  open()
  expect(await screen.findByText('老师还没排座位')).toBeInTheDocument()
})

it('shows the class card with homeroom and subject teachers', async () => {
  open()
  const card = await screen.findByRole('region', { name: '班级信息' })
  expect(within(card).getByText('三年二班')).toBeInTheDocument()
  expect(within(card).getByText('陈老师')).toBeInTheDocument()
  expect(within(card).getByText('数学')).toBeInTheDocument()
  expect(within(card).getByText('李老师')).toBeInTheDocument()
})

it('shows only the note card for a read-only child', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([
    child({ status: 'readonly', left_on: '2026-07-10', archive_on: '2027-07-10' }),
  ])
  vi.mocked(parentApi.today).mockResolvedValue(today({
    status: 'readonly', attendance: null, attendance_confirmed: false, class_info: null, enrollment_id: null, seat_map: null,
  }))
  open()
  expect(await screen.findByText('孩子已于 2026-07-10 毕业 / 离校,可以继续查看在校期间的成长与成绩,账号将于 2027-07-10 归档')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '今日出勤' })).toBeNull()
  expect(screen.queryByRole('region', { name: '班级座位' })).toBeNull()
  expect(screen.queryByRole('region', { name: '今日点评' })).toBeNull()
  expect(screen.queryByRole('region', { name: '班级信息' })).toBeNull()
})

it('shows a retryable error when today fails', async () => {
  vi.mocked(parentApi.today).mockRejectedValue(new Error('x'))
  open()
  expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
})
