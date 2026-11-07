import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ApiError } from '@/shared/api/client'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { SeatingSaved } from '@/shared/types/seating'
import type { StudentSeat } from '@/shared/types/student'
import SeatingBar, { type SeatingBarProps } from './SeatingBar'
import { seatingPrintHtml } from './printSeating'
import { useSeatingMode } from './useSeatingMode'
import type { DraftStudent } from './draft'
import {
  classFixture,
  defaultApiMocks,
  rosterFixture,
  setup,
  summaryFixture,
} from '../pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')
vi.mock('@/shared/api/exams')

// 裁定 R2:排座用例里张小三未排座
const roster = rosterFixture.map((s) =>
  s.enrollment_id === 'e3' ? { ...s, seat_row: null, seat_col: null } : s,
)

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
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenCalledWith('c1', {
      base_version: 4,
      rows: 3,
      cols: 4,
      seats: [
        { enrollment_id: 'e2', row: 1, col: 1, locked: false },
        { enrollment_id: 'e1', row: 1, col: 2, locked: false },
      ],
    }),
  )
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
})

it('places a tray student into an empty seat', async () => {
  setup({ mode: '排座' })
  fireEvent.click(
    within(await screen.findByRole('region', { name: '待安排 (1)' })).getByRole('button', {
      name: '张小三',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '空座 2排1列' }))
  expect(screen.getByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '待安排 (0)' })).toBeInTheDocument()
})

it('keeps the draft and offers reload on version conflict', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }),
  )
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
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(400, 'SEAT_INVALID', 'x', { reason: 'unknown_enrollment' }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('学生名单有变化,已重新加载')).toBeInTheDocument()
  await waitFor(() =>
    expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before),
  )
})

it('rebuilds a clean draft from the changed roster after SEAT_INVALID', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(400, 'SEAT_INVALID', 'x', { reason: 'unknown_enrollment' }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  // 服务端名单已变:张小三转走了
  vi.mocked(studentsApi.listInClass).mockResolvedValue({
    items: roster.filter((s) => s.enrollment_id !== 'e3'),
  })
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('学生名单有变化,已重新加载')).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  // 草稿按服务端的原位置重建,没有半途应用的交换
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  vi.mocked(seatingApi.save).mockImplementation(async (_c, body) => ({
    version: body.base_version + 1,
    rows: body.rows,
    cols: body.cols,
  }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenLastCalledWith('c1', {
      base_version: 4,
      rows: 3,
      cols: 4,
      seats: [
        { enrollment_id: 'e2', row: 1, col: 1, locked: false },
        { enrollment_id: 'e1', row: 1, col: 2, locked: false },
      ],
    }),
  )
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
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '日常' })).toHaveAttribute('aria-selected', 'true'),
  )
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
  vi.mocked(studentsApi.listInClass).mockResolvedValue({
    items: roster.map((s) =>
      s.enrollment_id === 'e1'
        ? { ...s, seat_col: 2 }
        : s.enrollment_id === 'e2'
          ? { ...s, seat_col: 1 }
          : s,
    ),
  })
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
  await waitFor(() =>
    expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
  // 新草稿以返回的版本为基准
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenLastCalledWith('c1', {
      base_version: 5,
      rows: 3,
      cols: 4,
      seats: [
        { enrollment_id: 'e1', row: 1, col: 1, locked: false },
        { enrollment_id: 'e2', row: 1, col: 2, locked: false },
      ],
    }),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
})

it('saves once when the save button is double-clicked', async () => {
  let resolve!: (v: SeatingSaved) => void
  vi.mocked(seatingApi.save).mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  const btn = screen.getByRole('button', { name: '保存座位' })
  act(() => {
    btn.click()
    btn.click()
  })
  expect(seatingApi.save).toHaveBeenCalledTimes(1)
  expect(btn).toBeDisabled()
  // 保存中草稿不可编辑:地图座位不可点、托盘禁用
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '空座 2排1列' })).toBeNull()
  openMore()
  expect(menuItem('放弃修改')).toHaveAttribute('aria-disabled', 'true')
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(
    within(screen.getByRole('region', { name: '待安排 (1)' })).getByRole('button', {
      name: '张小三',
    }),
  ).toBeDisabled()
  await act(async () => {
    resolve({ version: 5, rows: 3, cols: 4 })
  })
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
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenCalledWith('c1', {
      base_version: 4,
      rows: 3,
      cols: 4,
      seats: [{ enrollment_id: 'e1', row: 1, col: 1, locked: true }],
    }),
  )
  expect(await screen.findByText('座位已保存')).toBeInTheDocument()
})

it('marks the class switcher as guarded while the draft is dirty', async () => {
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  expect(useTeacherStore.getState().unsaved.seating).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(useTeacherStore.getState().unsaved.seating).toBe(true)
  openMore()
  fireEvent.click(menuItem('放弃修改'))
  expect(useTeacherStore.getState().unsaved.seating).toBe(false)
})

it('closes the pick card when entering seating mode', async () => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
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
  vi.mocked(studentsApi.listInClass).mockReturnValue(
    new Promise((r) => {
      resolveRoster = r
    }),
  )
  const summaryBefore = vi.mocked(classroomApi.summary).mock.calls.length
  const rosterBefore = vi.mocked(studentsApi.listInClass).mock.calls.length
  fireEvent.click(screen.getByRole('tab', { name: '排座' }))
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存座位' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
  await waitFor(() =>
    expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(rosterBefore),
  )
  const summaryCalls = vi.mocked(classroomApi.summary).mock
  expect(summaryCalls.calls.length).toBeGreaterThan(summaryBefore)
  // 名单在概况返回之后才请求
  const summaryAt = summaryCalls.invocationCallOrder[summaryCalls.invocationCallOrder.length - 1]
  const rosterAt = vi.mocked(studentsApi.listInClass).mock.invocationCallOrder.at(-1)!
  expect(rosterAt).toBeGreaterThan(summaryAt)
  expect(screen.queryByRole('button', { name: '保存座位' })).toBeNull()
  await act(async () => {
    resolveRoster({
      items: roster.map((s) => (s.enrollment_id === 'e1' ? { ...s, seat_row: 2, seat_col: 1 } : s)),
    })
  })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenCalledWith('c1', {
      base_version: 5,
      rows: 3,
      cols: 4,
      seats: [
        { enrollment_id: 'e1', row: 1, col: 2, locked: false },
        { enrollment_id: 'e2', row: 2, col: 1, locked: false },
      ],
    }),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
})

it('says the map is loading instead of silently ignoring clicks while the draft loads', async () => {
  setup()
  await screen.findByRole('button', { name: /^王小一，/ })
  let resolveRoster!: (v: { items: StudentSeat[] }) => void
  vi.mocked(studentsApi.listInClass).mockReturnValue(
    new Promise((r) => {
      resolveRoster = r
    }),
  )
  fireEvent.click(screen.getByRole('tab', { name: '排座' }))
  const toolbar = screen.getByRole('toolbar', { name: '教室工具' })
  expect(within(toolbar).getByRole('status')).toHaveTextContent('加载中…')
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeVisible()
  expect(screen.getByTestId('classroom-stage')).toHaveAttribute('aria-busy', 'true')
  await act(async () => {
    resolveRoster({ items: roster })
  })
  await waitFor(() => expect(screen.getByRole('button', { name: '随机打乱' })).toBeEnabled())
  expect(within(toolbar).queryByRole('status')).toBeNull()
  expect(screen.queryByText('座位表加载中,暂时不能调整座位')).toBeNull()
  expect(screen.getByTestId('classroom-stage')).not.toHaveAttribute('aria-busy')
})

it('says saving, then loading, while the saved layout is reloaded', async () => {
  let resolveSave!: (v: SeatingSaved) => void
  vi.mocked(seatingApi.save).mockReturnValue(
    new Promise((r) => {
      resolveSave = r
    }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  const toolbar = screen.getByRole('toolbar', { name: '教室工具' })
  expect(within(toolbar).getByRole('status')).toHaveTextContent('保存中…')
  expect(screen.getByText('正在保存,暂时不能调整座位')).toBeVisible()
  let resolveRoster!: (v: { items: StudentSeat[] }) => void
  vi.mocked(studentsApi.listInClass).mockReturnValue(
    new Promise((r) => {
      resolveRoster = r
    }),
  )
  await act(async () => {
    resolveSave({ version: 5, rows: 3, cols: 4 })
  })
  await waitFor(() => expect(within(toolbar).getByRole('status')).toHaveTextContent('加载中…'))
  expect(screen.getByText('座位表加载中,暂时不能调整座位')).toBeVisible()
  await act(async () => {
    resolveRoster({ items: roster })
  })
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
  vi.mocked(studentsApi.listInClass).mockResolvedValue({
    items: roster.map((s) =>
      s.enrollment_id === 'e1'
        ? { ...s, seat_col: 2 }
        : s.enrollment_id === 'e2'
          ? { ...s, seat_col: 1 }
          : s,
    ),
  })
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
  expect(await screen.findByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存座位' })).toBeDisabled()
})

it('focuses 继续编辑 when the conflict dialog opens', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByRole('button', { name: '继续编辑' })).toHaveFocus()
})

it('keeps the conflict dialog open on an outside click', async () => {
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 5 }),
  )
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
  for (const name of ['随机打乱', '男女同桌', '撤销', '保存座位', '更多操作'])
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  for (const name of ['放弃修改', '固定座位', '打印'])
    expect(screen.queryByRole('button', { name })).toBeNull()
  openMore()
  expect(
    within(screen.getByRole('menu', { name: '更多操作' }))
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['放弃修改', '固定座位', '打印', '班级设置', '编辑黑板'])
})

it('more menu opens inside the fullscreen root while presenting', async () => {
  stubFullscreen()
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  await screen.findByRole('button', { name: '退出全屏' })
  openMore()
  expect(
    (document.fullscreenElement as Element).contains(
      screen.getByRole('menu', { name: '更多操作' }),
    ),
  ).toBe(true)
})

it('no longer offers a rows and columns popover', async () => {
  setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  expect(screen.queryByRole('button', { name: '座位行列' })).toBeNull()
  expect(screen.queryByRole('button', { name: /排 × .* 列/ })).toBeNull()
  expect(screen.queryByRole('spinbutton', { name: '排数' })).toBeNull()
})

it('rejects a stale draft after the layout changed', async () => {
  // 别处改了桌椅排列:保存带着旧版本,服务端 409,草稿保留并弹出冲突对话框
  vi.mocked(seatingApi.save).mockRejectedValue(
    new ApiError(409, 'SEAT_VERSION_CONFLICT', 'x', { current_version: 6 }),
  )
  setup({ mode: '排座' })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  expect(await screen.findByRole('dialog', { name: '座位表已被其他人修改' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByRole('button', { name: '保存座位' })).toBeEnabled()
})

it('treats a podium seat inside the grid as seated and saves it first', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, podium_left: 1 }] })
  const withPodium = roster.map((s) =>
    s.enrollment_id === 'e3' ? { ...s, seat_row: 0, seat_col: -1 } : s,
  )
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: withPodium })
  setup({ mode: '排座', roster: withPodium })
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(screen.getByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
  await waitFor(() =>
    expect(seatingApi.save).toHaveBeenCalledWith('c1', {
      base_version: 4,
      rows: 3,
      cols: 4,
      seats: [
        { enrollment_id: 'e3', row: 0, col: -1, locked: false },
        { enrollment_id: 'e2', row: 1, col: 1, locked: false },
        { enrollment_id: 'e1', row: 1, col: 2, locked: false },
      ],
    }),
  )
})

it('disables mentor seating without exam scores', async () => {
  setup({ mode: '排座' })
  const btn = await screen.findByRole('button', { name: '优带弱' })
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('title', '还没有考试成绩')
})

// L14:不可用原因不能只放在 title 里(触屏与读屏都看不到):按钮旁可见文字 + aria-describedby
it('shows why mentor seating is unavailable next to the button and describes it for screen readers', () => {
  const { rerender } = render(<SeatingBar {...barProps({ canMentor: false })} />)
  const btn = screen.getByRole('button', { name: '优带弱' })
  expect(btn).toBeDisabled()
  expect(btn).toHaveAccessibleDescription('还没有考试成绩')
  expect(screen.getByText('还没有考试成绩')).toBeVisible()
  rerender(<SeatingBar {...barProps({ canMentor: true })} />)
  expect(screen.queryByText('还没有考试成绩')).toBeNull()
  expect(screen.getByRole('button', { name: '优带弱' })).not.toHaveAttribute('aria-describedby')
})

it('runs mentor seating from the bar', async () => {
  vi.mocked(examsApi.gradebook).mockResolvedValue({
    exams: [
      {
        id: 'x1',
        name: '月考',
        exam_type: '月考' as const,
        date: '2026-10-20',
        subjects: [{ name: '语文', full: 100 }],
        grade_exam_id: null,
        created_by_me: true,
        progress: { entered: 3, total: 3 },
        scores: { e1: { 语文: 90 }, e2: { 语文: 80 }, e3: { 语文: 70 } },
      },
    ],
  })
  setup({ mode: '排座' })
  const btn = await screen.findByRole('button', { name: '优带弱' })
  await waitFor(() => expect(btn).toBeEnabled())
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: '待安排 (0)' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.getByRole('region', { name: '待安排 (1)' })).toBeInTheDocument()
})

const barProps = (over: Partial<SeatingBarProps> = {}): SeatingBarProps => ({
  deskSize: 2,
  onOpenLayout: vi.fn(),
  layoutBlocked: false,
  canUndo: false,
  dirty: false,
  busy: false,
  selected: null,
  conflict: false,
  onShuffle: vi.fn(),
  onPair: vi.fn(),
  onMentor: vi.fn(),
  canMentor: true,
  onUndo: vi.fn(),
  onDiscard: vi.fn(),
  onToggleLock: vi.fn(),
  onPrint: vi.fn(),
  onSave: vi.fn(),
  onReload: vi.fn(),
  onKeepEditing: vi.fn(),
  ...over,
})

it('opens the desk layout from the bar and blocks it while the draft is dirty', () => {
  const props = barProps()
  const { rerender } = render(<SeatingBar {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '桌椅排列' }))
  expect(props.onOpenLayout).toHaveBeenCalledTimes(1)
  // 草稿有未保存的修改(layoutBlocked = dirty)时:禁用并说明原因
  rerender(<SeatingBar {...props} layoutBlocked dirty />)
  const blocked = screen.getByRole('button', { name: '桌椅排列' })
  expect(blocked).toBeDisabled()
  expect(blocked).toHaveAttribute('title', '先保存或放弃当前的座位修改')
  // 页面没有提供入口时不渲染按钮
  rerender(<SeatingBar {...props} onOpenLayout={undefined} />)
  expect(screen.queryByRole('button', { name: '桌椅排列' })).toBeNull()
})

it('hides pair buttons for single desks', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, desk_size: 1 }] })
  setup({ mode: '排座' })
  expect(await screen.findByRole('button', { name: '随机打乱' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '男女同桌' })).toBeNull()
  expect(screen.queryByRole('button', { name: '优带弱' })).toBeNull()
})

const ps = (name: string, no: string, row: number, col: number): DraftStudent => ({
  enrollmentId: name,
  name,
  studentNo: no,
  gender: null,
  row,
  col,
  locked: false,
})

it('prints podium seats, desk gaps, room and student numbers', () => {
  const html = seatingPrintHtml({
    className: '三年二班',
    schoolName: '示例小学',
    room: '求知楼 201',
    today: '2026-11-03',
    grid: { rows: 1, cols: 6, deskSize: 3, podiumLeft: 2, podiumRight: 1 },
    students: [ps('甲', '001', 0, -2), ps('乙', '002', 1, 1)],
  })
  expect(html).toContain('<h1>三年二班 座位表</h1>')
  expect(html).toContain('示例小学 · 求知楼 201 · 2026-11-03 · 讲台在上方')
  // 讲台左外侧座位的人在"讲台"之前(左边)
  expect(html.indexOf('甲')).toBeLessThan(html.indexOf('讲台</div>'))
  // 6 列 / 三人桌 = 2 张桌,中间 1 条过道
  expect(html.match(/class="gap"/g)).toHaveLength(1)
  expect(html).toContain('乙<small>002</small>')
  expect(html).toContain('>空<')
})

it('prints only the podium when there are no podium seats, and omits empty header parts', () => {
  const html = seatingPrintHtml({
    className: 'c',
    schoolName: '',
    room: '',
    today: '2026-11-03',
    grid: { rows: 1, cols: 2, deskSize: 1, podiumLeft: 0, podiumRight: 0 },
    students: [],
  })
  expect(html).toContain('2026-11-03 · 讲台在上方')
  expect(html.match(/讲台<\/div>/g)).toHaveLength(1)
  // 2 列 1 排 = 2 个空座(class 是 "seat e"),讲台行没有任何座位格
  expect(html.match(/class="seat/g)).toHaveLength(2)
  expect(html).not.toContain('class="ps')
})

it('escapes names in the printout', () => {
  const html = seatingPrintHtml({
    className: 'c',
    schoolName: '',
    room: '',
    today: '2026-11-03',
    grid: { rows: 1, cols: 2, deskSize: 2, podiumLeft: 0, podiumRight: 0 },
    students: [ps('<b>x</b>', '<i>', 1, 1)],
  })
  expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  expect(html).not.toContain('<b>x</b>')
  expect(html).toContain('&lt;i&gt;')
})

const gaps = (cols: number, deskSize: 1 | 2 | 3) =>
  (
    seatingPrintHtml({
      className: 'c',
      schoolName: '',
      room: '',
      today: 't',
      grid: { rows: 1, cols, deskSize, podiumLeft: 0, podiumRight: 0 },
      students: [],
    }).match(/class="gap"/g) ?? []
  ).length

it('orders podium seats outward-to-inward on the left and inward-to-outward on the right', () => {
  const html = seatingPrintHtml({
    className: 'c',
    schoolName: '',
    room: '',
    today: 't',
    grid: { rows: 1, cols: 2, deskSize: 2, podiumLeft: 2, podiumRight: 2 },
    students: [
      ps('左二', '1', 0, -2),
      ps('左一', '2', 0, -1),
      ps('右一', '3', 0, 1),
      ps('右二', '4', 0, 2),
    ],
  })
  const at = (n: string) => html.indexOf(n)
  expect(at('左二')).toBeLessThan(at('左一'))
  expect(at('左一')).toBeLessThan(html.indexOf('讲台</div>'))
  expect(html.indexOf('讲台</div>')).toBeLessThan(at('右一'))
  expect(at('右一')).toBeLessThan(at('右二'))
})

it('puts a gap only after each desk, never after the last column', () => {
  expect(gaps(5, 2)).toBe(2) // 列 2、4 后
  expect(gaps(6, 2)).toBe(2) // 列 6 是最后一列,不插
  expect(gaps(5, 3)).toBe(1) // 只有列 3 后
  expect(gaps(6, 3)).toBe(1)
  expect(gaps(4, 1)).toBe(3) // 单人桌:每列后都插,最后一列除外
})

it('drives layoutBlocked, print data and reload through useSeatingMode', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [{ ...classFixture, room: '求知楼 201' }] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ today: '2026-11-03' }))
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: roster })
  act(() => {
    useTeacherStore.setState({ classId: 'c1' })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let current!: ReturnType<typeof useSeatingMode>
  function Probe() {
    useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
    useQuery({ queryKey: ['class-students', 'c1'], queryFn: () => studentsApi.listInClass('c1') })
    useQuery({ queryKey: ['classroom', 'c1'], queryFn: () => classroomApi.summary('c1') })
    current = useSeatingMode({
      classId: 'c1',
      className: '三年二班',
      enabled: true,
      onOpenLayout: () => {},
    })
    return null
  }
  const router = createMemoryRouter([{ path: '/', element: <Probe /> }])
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(current.ready).toBe(true))
  if (!current.ready) throw new Error('not ready')
  expect(current.bar.layoutBlocked).toBe(false)

  const seat = (id: string) => roster.find((r) => r.enrollment_id === id)!
  act(() => current.onSeatClick?.(seat('e1')))
  act(() => current.onSeatClick?.(seat('e2')))
  if (!current.ready) throw new Error('not ready')
  expect(current.dirty).toBe(true)
  expect(current.bar?.layoutBlocked).toBe(true)

  // 打印用的是缓存里的学校、教室与日期
  const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  act(() => current.bar?.onPrint())
  const html = String(win.document.write.mock.calls[0][0])
  expect(html).toContain('示例小学 · 求知楼 201 · 2026-11-03 · 讲台在上方')

  // reload 重新拉取并丢掉草稿
  const before = vi.mocked(studentsApi.listInClass).mock.calls.length
  await act(async () => {
    await current.reload()
  })
  expect(vi.mocked(studentsApi.listInClass).mock.calls.length).toBeGreaterThan(before)
  await waitFor(() => expect(current.dirty).toBe(false))
  if (!current.ready) throw new Error('not ready')
  expect(current.bar.layoutBlocked).toBe(false)
})

it.each(['layout_mismatch', 'podium_unavailable'])(
  'says the layout changed on SEAT_INVALID (%s)',
  async (reason) => {
    vi.mocked(seatingApi.save).mockRejectedValue(new ApiError(400, 'SEAT_INVALID', 'x', { reason }))
    setup({ mode: '排座' })
    fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
    fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存座位' }))
    expect(await screen.findByText('班级的桌椅排列已变化,已重新加载')).toBeInTheDocument()
    expect(screen.queryByText('学生名单有变化,已重新加载')).toBeNull()
  },
)

it('keeps drawing the draft desks until the draft is rebuilt after the class settings change', async () => {
  const { client, container } = setup({ mode: '排座' })
  await screen.findByRole('button', { name: /^王小一，/ })
  expect(container.querySelector('[data-seat="0--1"]')).toBeNull()
  // 班级数据先于草稿刷新:地图桌型、讲台座位仍跟草稿走,不按新旧混合的桌椅画
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [{ ...classFixture, desk_size: 3, seat_cols: 6, podium_left: 1 }],
  })
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['my-classes'] })
  })
  await waitFor(() =>
    expect(
      client.getQueryData<{ items: { podium_left: number }[] }>(['my-classes'])?.items[0]
        .podium_left,
    ).toBe(1),
  )
  // 查询结果经 notifyManager 的 setTimeout(0) 才送到 ClassroomPage 的 useQuery:这段等待放进 act,
  // 那次更新就不会落在 act 之外(L259 基线上那条 "not wrapped in act" 警告的来源)
  await act(() => new Promise<void>((r) => setTimeout(r, 50)))
  expect(container.querySelector('[data-seat="0--1"]')).toBeNull()
})
