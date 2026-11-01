import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { SeatingSaved } from '@/shared/types/seating'
import { defaultApiMocks, rosterFixture, setup } from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

// 裁定 R2:排座用例里张小三未排座
const roster = rosterFixture.map((s) => (s.enrollment_id === 'e3' ? { ...s, seat_row: null, seat_col: null } : s))

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster })
})
afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = originalMatchMedia
})

it('swaps two students by clicking and saves with the base version', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenCalledWith('c1', { base_version: 4, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e2', row: 1, col: 1, locked: false }, { enrollment_id: 'e1', row: 1, col: 2, locked: false }] }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
})

it('places a tray student into an empty seat', async () => {
  setup({ mode: '排座' })
  fireEvent.click(within(await screen.findByRole('region', { name: '待安排 (1)' })).getByRole('button', { name: '张小三' }))
  fireEvent.click(screen.getByRole('button', { name: '空座 2排1列' }))
  expect(screen.getByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
})

it('keeps the draft and offers reload on version conflict', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('座位表已被其他人修改')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  fireEvent.click(await screen.findByRole('button', { name: '放弃我的修改并重新加载' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled())
})

it('refetches the roster when the server rejects the layout', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(400, 'SEAT_INVALID', 'x', { reason: 'unknown_enrollment' }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('学生名单有变化,已重新加载')).toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before))
})

it('pairs boys and girls, then undoes', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '男女同桌' }))
  expect(screen.getByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
})

it('asks before leaving with unsaved changes', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
  expect(screen.getByRole('tab', { name: '排座' })).toHaveAttribute('aria-selected', 'true')
})

it('prints the seating chart', async () => {
  const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '打印' }))
  expect(win.document.write).toHaveBeenCalledWith(expect.stringContaining('三年二班'))
})

// ---- 以下为补充用例 ----

it('rebuilds the draft from fresh data after saving', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster.map((s) =>
    s.enrollment_id === 'e1' ? { ...s, seat_col: 2 } : s.enrollment_id === 'e2' ? { ...s, seat_col: 1 } : s) })
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled())
  // 新草稿以返回的版本为基准
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenLastCalledWith('c1', { base_version: 5, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: false }, { enrollment_id: 'e2', row: 1, col: 2, locked: false }] }))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled())
})

it('saves once when the save button is double-clicked', async () => {
  let resolve!: (v: SeatingSaved) => void
  vi.mocked(seatingApi.save).mockReturnValue(new Promise((r) => { resolve = r }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  const btn = screen.getByRole('button', { name: '保存座位' })
  act(() => { btn.click(); btn.click() })
  expect(seatingApi.save).toHaveBeenCalledTimes(1)
  expect(btn).toBeDisabled()
  await act(async () => { resolve({ version: 5, rows: 3, cols: 4 }) })
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
  await waitFor(() => expect(btn).toBeDisabled())
  expect(seatingApi.save).toHaveBeenCalledTimes(1)
})

it('keeps the draft across a background refetch', async () => {
  const { client } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  const before = vi.mocked(classroomApi.summary).mock.calls.length
  await act(() => client.invalidateQueries({ queryKey: ['classroom', 'c1'] }))
  await act(() => client.invalidateQueries({ queryKey: ['class-students', 'c1'] }))
  expect(vi.mocked(classroomApi.summary).mock.calls.length).toBeGreaterThan(before)
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
})

it('locks a student and moves another one to the tray', async () => {
  setup({ mode: '排座' })
  expect(await screen.findByRole('button', { name: '固定座位' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '王小一' }))
  fireEvent.click(screen.getByRole('button', { name: '固定座位' }))
  // 固定的同学不能被换走:点了李小二再点王小一,只是改选王小一
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('button', { name: '王小一' }))
  expect(screen.getByRole('button', { name: '取消固定' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  fireEvent.click(screen.getByRole('button', { name: '移到待安排' }))
  expect(screen.getByRole('region', { name: '待安排 (2)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenCalledWith('c1', { base_version: 4, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: true }] }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
})

it('resizes within 1-12 and discards changes', async () => {
  setup({ mode: '排座' })
  const cols = await screen.findByRole('spinbutton', { name: '列数' })
  fireEvent.change(cols, { target: { value: '1' } })
  expect(screen.getByRole('region', { name: '待安排 (2)' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('spinbutton', { name: '排数' }), { target: { value: '20' } })
  expect(screen.getByRole('spinbutton', { name: '排数' })).toHaveValue(12)
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: '列数' })).toHaveValue(4)
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
})

it('marks the class switcher as guarded while the draft is dirty', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  expect(useTeacherStore.getState().seatingDirty).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  expect(useTeacherStore.getState().seatingDirty).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  expect(useTeacherStore.getState().seatingDirty).toBe(false)
})

it('closes the pick card when entering seating mode', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  expect(await screen.findByRole('dialog', { name: '随机点名' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '排座' }))
  expect(screen.queryByRole('dialog', { name: '随机点名' })).toBeNull()
  expect(await screen.findByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
})
