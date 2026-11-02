import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { SeatingSaved } from '@/shared/types/seating'
import type { StudentSeat } from '@/shared/types/student'
import { classFixture, defaultApiMocks, rosterFixture, setup, summaryFixture } from '../pageTestUtils'

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
const REQUEST_FULLSCREEN = Element.prototype.requestFullscreen
const EXIT_FULLSCREEN = document.exitFullscreen

function stubFullscreen() {
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  document.exitFullscreen = vi.fn(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
}

const SIZE_BUTTON = /排 × .* 列/
const openSize = () => fireEvent.click(screen.getByRole('button', { name: SIZE_BUTTON }))
const openMore = () => fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
const menuItem = (name: string) => screen.getByRole('menuitem', { name })

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster })
})
afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = originalMatchMedia
  Element.prototype.requestFullscreen = REQUEST_FULLSCREEN
  document.exitFullscreen = EXIT_FULLSCREEN
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
})

it('swaps two students by clicking and saves with the base version', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
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
  expect(screen.getByRole('heading', { name: '待安排 (0)' })).toBeInTheDocument()
})

it('keeps the draft and offers reload on version conflict', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
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
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('学生名单有变化,已重新加载')).toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before))
})

it('rebuilds a clean draft from the changed roster after SEAT_INVALID', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(400, 'SEAT_INVALID', 'x', { reason: 'unknown_enrollment' }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  // 服务端名单已变:张小三转走了
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster.filter((s) => s.enrollment_id !== 'e3') })
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('学生名单有变化,已重新加载')).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  // 草稿按服务端的原位置重建,没有半途应用的交换
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  vi.mocked(seatingApi.save).mockImplementation(async (_c, body) => ({ version: body.base_version + 1, rows: body.rows, cols: body.cols }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenLastCalledWith('c1', { base_version: 4, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e2', row: 1, col: 1, locked: false }, { enrollment_id: 'e1', row: 1, col: 2, locked: false }] }))
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
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
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
  expect(screen.getByRole('tab', { name: '排座' })).toHaveAttribute('aria-selected', 'true')
})

it('asks once when leaving seating through the tab bar', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  await waitFor(() => expect(screen.getByRole('tab', { name: '日常' })).toHaveAttribute('aria-selected', 'true'))
  expect(confirmSpy).toHaveBeenCalledTimes(1)
})

it('asks before a route change with unsaved changes and stays when declined', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { router } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  await act(() => router.navigate('/teacher/preferences'))
  expect(confirmSpy).toHaveBeenCalledWith('有未保存的座位修改,确定离开吗?')
  expect(router.state.location.pathname).toBe('/teacher/classroom')
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
  confirmSpy.mockReturnValue(true)
  await act(() => router.navigate('/teacher/preferences'))
  expect(confirmSpy).toHaveBeenCalledTimes(2)
  expect(await screen.findByTestId('loc')).toHaveTextContent('/teacher/preferences')
})

it('guards a link back to the plain classroom page, which would leave seating mode', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { router } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  await act(() => router.navigate('/teacher/classroom'))
  expect(confirmSpy).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('tab', { name: '排座' })).toHaveAttribute('aria-selected', 'true')
})

it('does not ask before a route change when nothing is unsaved', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm')
  const { router } = setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  await act(() => router.navigate('/teacher/preferences'))
  expect(confirmSpy).not.toHaveBeenCalled()
  expect(await screen.findByTestId('loc')).toHaveTextContent('/teacher/preferences')
})

it('prints the seating chart', async () => {
  const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: '更多操作' })
  openMore()
  fireEvent.click(menuItem('打印'))
  expect(win.document.write).toHaveBeenCalledWith(expect.stringContaining('三年二班'))
})

// ---- 以下为补充用例 ----

it('rebuilds the draft from fresh data after saving', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster.map((s) =>
    s.enrollment_id === 'e1' ? { ...s, seat_col: 2 } : s.enrollment_id === 'e2' ? { ...s, seat_col: 1 } : s) })
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before))
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  // 新草稿以返回的版本为基准
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenLastCalledWith('c1', { base_version: 5, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: false }, { enrollment_id: 'e2', row: 1, col: 2, locked: false }] }))
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
})

it('saves once when the save button is double-clicked', async () => {
  let resolve!: (v: SeatingSaved) => void
  vi.mocked(seatingApi.save).mockReturnValue(new Promise((r) => { resolve = r }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const btn = screen.getByRole('button', { name: '保存座位' })
  act(() => { btn.click(); btn.click() })
  expect(seatingApi.save).toHaveBeenCalledTimes(1)
  expect(btn).toBeDisabled()
  // 保存中草稿不可编辑:地图座位不可点、行列与托盘禁用
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '空座 2排1列' })).toBeNull()
  expect(screen.getByRole('button', { name: SIZE_BUTTON })).toBeDisabled()
  openMore()
  expect(menuItem('放弃修改')).toHaveAttribute('aria-disabled', 'true')
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(within(screen.getByRole('region', { name: '待安排 (1)' })).getByRole('button', { name: '张小三' })).toBeDisabled()
  await act(async () => { resolve({ version: 5, rows: 3, cols: 4 }) })
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
  expect(btn).toBeDisabled()
  expect(seatingApi.save).toHaveBeenCalledTimes(1)
})

it('keeps the draft across a background refetch', async () => {
  const { client } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const before = vi.mocked(classroomApi.summary).mock.calls.length
  await act(() => client.invalidateQueries({ queryKey: ['classroom', 'c1'] }))
  await act(() => client.invalidateQueries({ queryKey: ['class-students', 'c1'] }))
  expect(vi.mocked(classroomApi.summary).mock.calls.length).toBeGreaterThan(before)
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
})

it('locks a student and moves another one to the tray', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: '更多操作' })
  openMore()
  expect(menuItem('固定座位')).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  openMore()
  fireEvent.click(menuItem('固定座位'))
  // 固定的同学不能被换走:点了李小二再点王小一,只是改选王小一
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  openMore()
  expect(menuItem('取消固定')).not.toHaveAttribute('aria-disabled')
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '移到待安排' }))
  expect(screen.getByRole('region', { name: '待安排 (2)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenCalledWith('c1', { base_version: 4, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: true }] }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
})

it('resizes within 1-12 and discards changes', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: SIZE_BUTTON })
  openSize()
  const cols = screen.getByRole('spinbutton', { name: '列数' })
  fireEvent.change(cols, { target: { value: '1' } })
  fireEvent.blur(cols)
  expect(screen.getByRole('region', { name: '待安排 (2)' })).toBeInTheDocument()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  fireEvent.change(rows, { target: { value: '20' } })
  expect(rows).toHaveAttribute('aria-invalid', 'true')
  fireEvent.keyDown(rows, { key: 'Enter' })
  expect(rows).toHaveValue(12)
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
  openMore()
  fireEvent.click(menuItem('放弃修改'))
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  openSize()
  expect(screen.getByRole('spinbutton', { name: '列数' })).toHaveValue(4)
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
})

it('applies a typed row count only when committed, keeping every seat', async () => {
  const sixRows = { ...classFixture, seat_rows: 6 }
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [sixRows] })
  const spread = roster.map((s) => (s.enrollment_id === 'e2' ? { ...s, seat_row: 6, seat_col: 2 } : s))
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: spread })
  setup({ mode: '排座', roster: spread })
  await screen.findByRole('button', { name: SIZE_BUTTON })
  openSize()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  expect(rows).toHaveValue(6)
  // 逐键输入 "1" → "10":中途不调整网格,没有学生被挤进待安排
  fireEvent.change(rows, { target: { value: '1' } })
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  fireEvent.change(rows, { target: { value: '10' } })
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  fireEvent.blur(rows)
  expect(rows).toHaveValue(10)
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenCalledWith('c1', { base_version: 4, rows: 10, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: false }, { enrollment_id: 'e2', row: 6, col: 2, locked: false }] }))
})

it('steps the size with the buttons and ignores invalid typing', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: SIZE_BUTTON })
  openSize()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  fireEvent.click(screen.getByRole('button', { name: '增加排数' }))
  expect(rows).toHaveValue(4)
  fireEvent.click(screen.getByRole('button', { name: '减少排数' }))
  expect(rows).toHaveValue(3)
  fireEvent.change(rows, { target: { value: '' } })
  expect(rows).toHaveAttribute('aria-invalid', 'true')
  fireEvent.blur(rows)
  expect(rows).toHaveValue(3)
  expect(rows).not.toHaveAttribute('aria-invalid')
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
})

it('marks the class switcher as guarded while the draft is dirty', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  expect(useTeacherStore.getState().seatingDirty).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(useTeacherStore.getState().seatingDirty).toBe(true)
  openMore()
  fireEvent.click(menuItem('放弃修改'))
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

it('builds the draft from data fetched summary-first when entering seating mode', async () => {
  setup()
  await screen.findByRole('button', { name: /^王小一，/ })
  // 停留在日常时别人保存了座位:版本变 5,王小一被移到 2排1列
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ seat_version: 5 }))
  let resolveRoster!: (v: { items: StudentSeat[] }) => void
  vi.mocked(studentsApi.listInClass).mockReturnValue(new Promise((r) => { resolveRoster = r }))
  const summaryBefore = vi.mocked(classroomApi.summary).mock.calls.length
  const rosterBefore = vi.mocked(studentsApi.listInClass).mock.calls.length
  fireEvent.click(screen.getByRole('tab', { name: '排座' }))
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存座位' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
  await waitFor(() => expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(rosterBefore))
  const summaryCalls = vi.mocked(classroomApi.summary).mock
  expect(summaryCalls.calls.length).toBeGreaterThan(summaryBefore)
  // 名单在概况返回之后才请求
  const summaryAt = summaryCalls.invocationCallOrder[summaryCalls.invocationCallOrder.length - 1]
  const rosterAt = vi.mocked(studentsApi.listInClass).mock.invocationCallOrder.at(-1)!
  expect(rosterAt).toBeGreaterThan(summaryAt)
  expect(screen.queryByRole('button', { name: '保存座位' })).toBeNull()
  await act(async () => {
    resolveRoster({ items: roster.map((s) => (s.enrollment_id === 'e1' ? { ...s, seat_row: 2, seat_col: 1 } : s)) })
  })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() => expect(seatingApi.save).toHaveBeenCalledWith('c1', { base_version: 5, rows: 3, cols: 4,
    seats: [{ enrollment_id: 'e1', row: 1, col: 2, locked: false }, { enrollment_id: 'e2', row: 2, col: 1, locked: false }] }))
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
})

it('says the map is loading instead of silently ignoring clicks while the draft loads', async () => {
  setup()
  await screen.findByRole('button', { name: /^王小一，/ })
  let resolveRoster!: (v: { items: StudentSeat[] }) => void
  vi.mocked(studentsApi.listInClass).mockReturnValue(new Promise((r) => { resolveRoster = r }))
  fireEvent.click(screen.getByRole('tab', { name: '排座' }))
  const toolbar = screen.getByRole('toolbar', { name: '教室工具' })
  expect(within(toolbar).getByRole('status')).toHaveTextContent('加载中…')
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeVisible()
  expect(screen.getByTestId('classroom-stage')).toHaveAttribute('aria-busy', 'true')
  await act(async () => { resolveRoster({ items: roster }) })
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
  expect(within(toolbar).queryByRole('status')).toBeNull()
  expect(screen.queryByText('座位表加载中,暂时不能调整座位')).toBeNull()
  expect(screen.getByTestId('classroom-stage')).not.toHaveAttribute('aria-busy')
})

it('says saving, then loading, while the saved layout is reloaded', async () => {
  let resolveSave!: (v: SeatingSaved) => void
  vi.mocked(seatingApi.save).mockReturnValue(new Promise((r) => { resolveSave = r }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  const toolbar = screen.getByRole('toolbar', { name: '教室工具' })
  expect(within(toolbar).getByRole('status')).toHaveTextContent('保存中…')
  expect(screen.getByText('正在保存,暂时不能调整座位')).toBeVisible()
  let resolveRoster!: (v: { items: StudentSeat[] }) => void
  vi.mocked(studentsApi.listInClass).mockReturnValue(new Promise((r) => { resolveRoster = r }))
  await act(async () => { resolveSave({ version: 5, rows: 3, cols: 4 }) })
  await waitFor(() => expect(within(toolbar).getByRole('status')).toHaveTextContent('加载中…'))
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeVisible()
  await act(async () => { resolveRoster({ items: roster }) })
  await waitFor(() => expect(within(toolbar).queryByRole('status')).toBeNull())
})

it('stays read-only with a retry when fresh data cannot be loaded after saving', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  vi.mocked(studentsApi.listInClass).mockRejectedValue(new Error('boom'))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('座位表加载失败,请重试')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存座位' })).toBeNull()
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster.map((s) =>
    s.enrollment_id === 'e1' ? { ...s, seat_col: 2 } : s.enrollment_id === 'e2' ? { ...s, seat_col: 1 } : s) })
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
  expect(await screen.findByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
})

it('focuses 继续编辑 when the conflict dialog opens', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByRole('button', { name: '继续编辑' })).toHaveFocus()
})

it('keeps the conflict dialog open on an outside click', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }))
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  const dialog = await screen.findByRole('dialog', { name: '座位表已被其他人修改' })
  expect(within(dialog).getByRole('button', { name: '继续编辑' })).toHaveFocus()
  await act(() => new Promise((r) => setTimeout(r, 0)))
  fireEvent.pointerDown(document.body)
  expect(screen.getByRole('dialog', { name: '座位表已被其他人修改' })).toBeInTheDocument()
})

it('keeps an unsaved draft when a background refetch of classes or roster fails', async () => {
  const { client } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
  vi.mocked(classesApi.mine).mockRejectedValue(new Error('500'))
  vi.mocked(studentsApi.listInClass).mockRejectedValue(new Error('500'))
  await act(() => client.refetchQueries({ queryKey: ['my-classes'] }))
  await act(() => client.refetchQueries({ queryKey: ['class-students', 'c1'] }))
  await waitFor(() => expect(client.getQueryState(['class-students', 'c1'])?.status).toBe('error'))
  expect(client.getQueryState(['my-classes'])?.status).toBe('error')
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
  expect(screen.queryByText('班级加载失败')).toBeNull()
  expect(screen.queryByText('名单加载失败')).toBeNull()
})

it('guards page unload only while the draft has unsaved changes', async () => {
  const unload = () => {
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  }
  const add = vi.spyOn(window, 'addEventListener')
  const { unmount } = setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  expect(unload()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  expect(unload()).toBe(true)
  openMore()
  fireEvent.click(menuItem('放弃修改'))
  expect(unload()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(unload()).toBe(true)
  unmount()
  expect(unload()).toBe(false)
})

it('shows the common seating actions directly and the rest under 更多操作', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  for (const name of ['随机打乱', '男女同桌', '撤销', '3 排 × 4 列', '保存座位', '更多操作'])
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  for (const name of ['放弃修改', '固定座位', '打印']) expect(screen.queryByRole('button', { name })).toBeNull()
  openMore()
  expect(within(screen.getByRole('menu', { name: '更多操作' })).getAllByRole('menuitem').map((i) => i.textContent))
    .toEqual(['放弃修改', '固定座位', '打印', '编辑黑板'])
})

it('typing a row count then leaving the popover applies it', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  openSize()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  fireEvent.change(rows, { target: { value: '5' } })
  act(() => rows.blur())
  fireEvent.click(document.body)
  expect(screen.queryByRole('dialog', { name: '座位行列' })).toBeNull()
  expect(screen.getByRole('button', { name: '5 排 × 4 列' })).toBeInTheDocument()
})

it('Escape closes the size popover without applying typed text', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  openSize()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  fireEvent.change(rows, { target: { value: '5' } })
  fireEvent.keyDown(rows, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '座位行列' })).toBeNull()
  const trigger = screen.getByRole('button', { name: '3 排 × 4 列' })
  expect(trigger).toHaveFocus()
})

it('focuses and selects the row count when the size popover opens', async () => {
  const select = vi.spyOn(HTMLInputElement.prototype, 'select')
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  openSize()
  const rows = screen.getByRole('spinbutton', { name: '排数' })
  expect(rows).toHaveFocus()
  expect(select).toHaveBeenCalled()
  expect(select.mock.contexts.at(-1)).toBe(rows)
  select.mockClear()
  fireEvent.focus(screen.getByRole('spinbutton', { name: '列数' }))
  expect(select).toHaveBeenCalledTimes(1)
  select.mockRestore()
})

it('more menu opens inside the fullscreen root while presenting', async () => {
  stubFullscreen()
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  await screen.findByRole('button', { name: '退出全屏' })
  openMore()
  expect((document.fullscreenElement as Element).contains(screen.getByRole('menu', { name: '更多操作' }))).toBe(true)
})
